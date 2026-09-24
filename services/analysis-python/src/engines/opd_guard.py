"""
ERP Preflight — OPD Guard Engine
S/4HANA Output Parameter Determination & BRFplus Decision Table Evaluator
"""

from typing import Dict, Any, List, Optional, Tuple, Set
import csv
import io
import json
import re
import zipfile
import defusedxml.ElementTree as DefusedET

from src.core.base_engine import BaseEngine
from src.core.registry import register_engine
from src.models.enums import EngineType, ArtifactType, AnalysisStatus, Severity, ConfidenceClass
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.parsers.safe_xml import SafeXmlParser
from src.platform.evidence import EvidenceEngine


@register_engine
class OPDGuardEngine(BaseEngine):
    engine_type = EngineType.OPD_GUARD
    name = "OPD Guard"
    description = "S/4HANA Output Parameter Determination & BRFplus decision table evaluation"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON, ArtifactType.XML]

    CANONICAL_STEPS = [
        "Output Type",
        "Receiver",
        "Channel",
        "Printer",
        "Email Recipient",
        "Email Sender",
        "Form Template",
        "Output Relevance",
    ]

    STEP_ALIASES: Dict[str, str] = {
        "output type": "Output Type",
        "output_type": "Output Type",
        "outputtype": "Output Type",
        "receiver": "Receiver",
        "channel": "Channel",
        "printer": "Printer",
        "print queue": "Printer",
        "printer queue": "Printer",
        "print_queue": "Printer",
        "printer / print queue": "Printer",
        "email recipient": "Email Recipient",
        "email_recipient": "Email Recipient",
        "email recipient / sender": "Email Recipient",
        "email sender": "Email Sender",
        "email_sender": "Email Sender",
        "form template": "Form Template",
        "form_template": "Form Template",
        "formtemplate": "Form Template",
        "output relevance": "Output Relevance",
        "output_relevance": "Output Relevance",
        "relevance": "Output Relevance",
    }

    VALID_CHANNELS = {"EMAIL", "PRINT", "EDI", "XML", "IDOC", "PORTAL"}

    def _normalize_step_name(self, name: str) -> str:
        clean = name.strip().lower()
        return self.STEP_ALIASES.get(clean, name.strip())

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        findings: List[Finding] = []
        rules_evaluated = 0
        artifacts_scanned = max(1, len(request.artifacts))

        # 1. Parse Input Artifacts (Tables & Scenario)
        tables, scenario, source_lines, step_lines, artifact_path, raw_content_str = self._parse_inputs(request)
        artifact_hash = EvidenceEngine.compute_sha256(raw_content_str)

        # 2. Check for Shadowed / Unreachable Rules Across All Tables
        shadowed_count, shadow_findings = self._audit_shadowed_rules(tables, source_lines, artifact_path, artifact_hash)
        findings.extend(shadow_findings)

        # 3. Execute Sequential Multi-Step Determination Pipeline
        pipeline_status, determined_results, first_failed_step, pipe_findings, step_rules_count = self._execute_pipeline(
            tables=tables,
            scenario=scenario,
            source_lines=source_lines,
            artifact_path=artifact_path,
            artifact_hash=artifact_hash,
            target_release=request.target_release,
            step_lines=step_lines,
        )
        findings.extend(pipe_findings)
        rules_evaluated += step_rules_count + shadowed_count

        # 4. Formulate Response Status and Metrics
        status = AnalysisStatus.COMPLETED
        if first_failed_step and not determined_results.get("Output Type"):
            status = AnalysisStatus.PARTIAL

        additional_metrics = {
            "totalStepsEvaluated": len(self.CANONICAL_STEPS),
            "successfulSteps": len([k for k, v in determined_results.items() if v]),
            "firstFailedStep": first_failed_step,
            "shadowed_rules_count": shadowed_count,
            "results": determined_results,
        }

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=status,
            findings=findings,
            metrics=AnalysisMetrics(
                rules_evaluated=max(rules_evaluated, 1),
                artifacts_scanned=artifacts_scanned,
                additional_metrics=additional_metrics,
            ),
        )

    # -------------------------------------------------------------------------
    # Parsing Engine (XML, JSON, CSV, XLSX)
    # -------------------------------------------------------------------------
    def _parse_inputs(
        self, request: AnalysisRequest
    ) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, str], Dict[str, Dict[int, int]], Dict[str, int], str, str]:
        """
        Parses tables and scenario from direct raw_content, configuration, or artifacts.
        Returns:
            tables: {step_name: [ {col: val, ...} ]}
            scenario: {field_name: val}
            source_lines: {step_name: {row_index: 1_based_line_number}}
            step_lines: {step_name: 1_based_line_number_of_table_tag}
            artifact_path: string path for evidence
            raw_content_str: raw string representation for hashing
        """
        tables: Dict[str, List[Dict[str, Any]]] = {}
        scenario: Dict[str, str] = {}
        source_lines: Dict[str, Dict[int, int]] = {}
        step_lines: Dict[str, int] = {}
        artifact_path = (
            request.artifact_s3_key
            or request.configuration.get("artifact_path")
            or request.configuration.get("file_name")
            or (request.artifacts[0].file_name if request.artifacts and request.artifacts[0].file_name else None)
            or "opd_decision_tables"
        )
        raw_content_str = request.raw_content or ""

        # Merge scenario from configuration if present
        if isinstance(request.configuration.get("scenario"), dict):
            for k, v in request.configuration["scenario"].items():
                scenario[str(k)] = str(v)

        # Merge pre-structured tables from configuration if present
        if isinstance(request.configuration.get("tables"), dict):
            for step_key, rows in request.configuration["tables"].items():
                norm_step = self._normalize_step_name(step_key)
                if isinstance(rows, list):
                    tables[norm_step] = rows
                    source_lines[norm_step] = {i: i + 2 for i in range(len(rows))}

        # Parse inline raw_content
        if request.raw_content and request.raw_content.strip():
            raw_content_str = request.raw_content.strip()
            # 1. Attempt XML if starts with '<' or request.artifact_type is XML
            if raw_content_str.startswith("<") or request.artifact_type == ArtifactType.XML:
                xml_tables, xml_scen, xml_lines, xml_step_lines = self._parse_xml_content(raw_content_str)
                if xml_tables or xml_scen:
                    tables.update(xml_tables)
                    scenario.update(xml_scen)
                    source_lines.update(xml_lines)
                    step_lines.update(xml_step_lines)

            # 2. Attempt JSON if not populated or if starts with '{' or '['
            if not tables and (raw_content_str.startswith("{") or raw_content_str.startswith("[")):
                try:
                    parsed_json = json.loads(raw_content_str)
                    if isinstance(parsed_json, dict):
                        if "scenario" in parsed_json and isinstance(parsed_json["scenario"], dict):
                            for k, v in parsed_json["scenario"].items():
                                scenario[str(k)] = str(v)
                        raw_tables = parsed_json.get("tables") or parsed_json.get("decision_tables") or {}
                        if isinstance(raw_tables, dict):
                            for step_key, rows in raw_tables.items():
                                norm_step = self._normalize_step_name(step_key)
                                if isinstance(rows, list):
                                    tables[norm_step] = rows
                                    source_lines[norm_step] = {i: i + 2 for i in range(len(rows))}
                except Exception:
                    pass

            # 3. If not JSON/XML, or if tables empty, check for CSV format
            if not tables and ("," in raw_content_str or "\n" in raw_content_str):
                csv_tables, csv_lines = self._parse_csv_content(raw_content_str, request.configuration)
                tables.update(csv_tables)
                source_lines.update(csv_lines)

        # Parse artifact attachments (XML, JSON, CSV, XLSX)
        for art in request.artifacts:
            content = art.raw_content or ""
            if not content:
                continue
            art_path = art.file_name or "artifact"
            if art.artifact_type == ArtifactType.XML or art_path.endswith(".xml") or content.strip().startswith("<"):
                xml_tables, xml_scen, xml_lines, xml_step_lines = self._parse_xml_content(content)
                tables.update(xml_tables)
                scenario.update(xml_scen)
                source_lines.update(xml_lines)
                step_lines.update(xml_step_lines)
                if not request.artifact_s3_key:
                    artifact_path = art_path
                if not raw_content_str:
                    raw_content_str = content
            elif art.artifact_type == ArtifactType.JSON or art_path.endswith(".json"):
                try:
                    p_json = json.loads(content)
                    if "scenario" in p_json:
                        scenario.update({str(k): str(v) for k, v in p_json["scenario"].items()})
                    r_tables = p_json.get("tables") or {}
                    for k, rows in r_tables.items():
                        norm_k = self._normalize_step_name(k)
                        tables[norm_k] = rows
                        source_lines[norm_k] = {i: i + 2 for i in range(len(rows))}
                except Exception:
                    pass
                if not raw_content_str:
                    raw_content_str = content
            elif art.artifact_type == ArtifactType.CSV or art_path.endswith(".csv"):
                csv_tables, csv_lines = self._parse_csv_content(content, request.configuration, file_name=art_path)
                tables.update(csv_tables)
                source_lines.update(csv_lines)
                if not raw_content_str:
                    raw_content_str = content
            elif art.artifact_type == ArtifactType.XLSX or art_path.endswith(".xlsx"):
                xlsx_tables, xlsx_lines = self._parse_xlsx_binary(content, art_path)
                tables.update(xlsx_tables)
                source_lines.update(xlsx_lines)
                if not raw_content_str:
                    raw_content_str = content

        return tables, scenario, source_lines, step_lines, artifact_path, raw_content_str

    def _parse_xml_content(
        self, xml_text: str
    ) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, str], Dict[str, Dict[int, int]], Dict[str, int]]:
        """
        Parses XML decision tables and scenario using SafeXmlParser (defusedxml with line retention).
        Extracts exact 1-based source lines for both tables/steps and individual rows.
        """
        tables: Dict[str, List[Dict[str, Any]]] = {}
        scenario: Dict[str, str] = {}
        source_lines: Dict[str, Dict[int, int]] = {}
        step_lines: Dict[str, int] = {}

        try:
            root = SafeXmlParser.parse_string(xml_text)
        except Exception:
            return tables, scenario, source_lines, step_lines

        # 1. Parse Scenario
        scen_elem = root.find(".//Scenario")
        if scen_elem is None:
            scen_elem = root.find(".//DocumentParameters") or root.find(".//Parameters")
        if scen_elem is not None:
            for child in scen_elem:
                tag = child.tag.strip()
                val = (child.text or "").strip()
                scenario[tag] = val

        # 2. Parse Decision Tables
        table_elements = (
            root.findall(".//DecisionTable")
            + root.findall(".//DecisionTables/Table")
            + root.findall(".//Table")
        )
        seen_elems: Set[Any] = set()
        for table_elem in table_elements:
            if table_elem in seen_elems:
                continue
            seen_elems.add(table_elem)

            raw_name = (
                table_elem.attrib.get("name")
                or table_elem.attrib.get("step")
                or table_elem.attrib.get("id")
                or ""
            )
            if not raw_name:
                name_child = table_elem.find("Name") or table_elem.find("StepName")
                if name_child is not None and name_child.text:
                    raw_name = name_child.text.strip()
            if not raw_name:
                continue

            step_name = self._normalize_step_name(raw_name)
            step_line = getattr(table_elem, "sourceline", int(table_elem.attrib.get("line_number", 1)))
            step_lines[step_name] = step_line

            rows: List[Dict[str, Any]] = []
            line_map: Dict[int, int] = {}

            row_elements = table_elem.findall(".//Row") or table_elem.findall("./Row")
            for r_idx, row_elem in enumerate(row_elements):
                r_line = getattr(row_elem, "sourceline", int(row_elem.attrib.get("line_number", step_line)))
                row_dict: Dict[str, Any] = {}
                for col_elem in row_elem:
                    col_name = col_elem.tag
                    if col_elem.tag in ("Column", "Cell", "Field") and (
                        "name" in col_elem.attrib or "col" in col_elem.attrib
                    ):
                        col_name = col_elem.attrib.get("name") or col_elem.attrib.get("col") or col_name
                    val = (col_elem.text or "").strip()
                    row_dict[col_name] = val
                rows.append(row_dict)
                line_map[r_idx] = r_line

            tables[step_name] = rows
            source_lines[step_name] = line_map

        return tables, scenario, source_lines, step_lines

    def _parse_csv_content(
        self, csv_text: str, config: Dict[str, Any], file_name: str = "tables.csv"
    ) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Dict[int, int]]]:
        """Parses CSV content supporting single tables and multi-table section headers."""
        tables: Dict[str, List[Dict[str, Any]]] = {}
        source_lines: Dict[str, Dict[int, int]] = {}

        current_step = config.get("default_step", "Output Type")
        lines = csv_text.splitlines()
        reader_buffer: List[Tuple[int, str]] = []

        for line_num, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            # Detect multi-step markers like '# Step: Channel' or '[Channel]'
            if stripped.startswith("#") or stripped.startswith("["):
                header_match = re.search(r"(?:Step|Table|#|\[)\s*:?\s*([A-Za-z0-9 /_-]+)", stripped, re.IGNORECASE)
                if header_match:
                    pot_step = header_match.group(1).replace("]", "").strip()
                    norm = self._normalize_step_name(pot_step)
                    if norm in self.CANONICAL_STEPS:
                        if reader_buffer:
                            t_rows, t_lines = self._parse_csv_block(reader_buffer)
                            tables[current_step] = t_rows
                            source_lines[current_step] = t_lines
                            reader_buffer = []
                        current_step = norm
                        continue
            reader_buffer.append((line_num, line))

        if reader_buffer:
            t_rows, t_lines = self._parse_csv_block(reader_buffer)
            norm_step = self._normalize_step_name(current_step)
            tables[norm_step] = t_rows
            source_lines[norm_step] = t_lines

        return tables, source_lines

    def _parse_csv_block(self, line_tuples: List[Tuple[int, str]]) -> Tuple[List[Dict[str, Any]], Dict[int, int]]:
        rows: List[Dict[str, Any]] = []
        line_map: Dict[int, int] = {}
        if not line_tuples:
            return rows, line_map

        raw_csv = "\n".join(t[1] for t in line_tuples)
        reader = csv.reader(io.StringIO(raw_csv))
        header: Optional[List[str]] = None
        row_idx = 0

        for tuple_idx, csv_row in enumerate(reader):
            if tuple_idx >= len(line_tuples):
                break
            actual_line_no = line_tuples[tuple_idx][0]
            if not csv_row or not any(csv_row):
                continue
            if header is None:
                header = [h.strip() for h in csv_row]
                continue

            row_dict: Dict[str, Any] = {}
            for col_idx, col_name in enumerate(header):
                val = csv_row[col_idx].strip() if col_idx < len(csv_row) else ""
                row_dict[col_name] = val

            rows.append(row_dict)
            line_map[row_idx] = actual_line_no
            row_idx += 1

        return rows, line_map

    def _parse_xlsx_binary(
        self, content: Any, file_name: str
    ) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Dict[int, int]]]:
        """
        Pure-Python, memory-bounded, zero-dependency XLSX parser utilizing standard
        zipfile and defusedxml to extract sheets, rows, and cell text.
        """
        tables: Dict[str, List[Dict[str, Any]]] = {}
        source_lines: Dict[str, Dict[int, int]] = {}

        try:
            byte_data = content.encode("latin1") if isinstance(content, str) else content
            stream = io.BytesIO(byte_data)
            with zipfile.ZipFile(stream, "r") as zf:
                # 1. Read shared strings
                shared_strings: List[str] = []
                if "xl/sharedStrings.xml" in zf.namelist():
                    ss_xml = zf.read("xl/sharedStrings.xml")
                    ss_root = DefusedET.fromstring(ss_xml)
                    for si in ss_root.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                        t_elem = si.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                        shared_strings.append(t_elem.text if t_elem is not None and t_elem.text else "")

                # 2. Read sheet manifest from workbook
                if "xl/workbook.xml" not in zf.namelist():
                    return tables, source_lines

                wb_root = DefusedET.fromstring(zf.read("xl/workbook.xml"))
                ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
                sheets = wb_root.findall("main:sheets/main:sheet", ns)

                for sheet_idx, sheet in enumerate(sheets, start=1):
                    sheet_name = sheet.attrib.get("name", f"Sheet{sheet_idx}")
                    norm_step = self._normalize_step_name(sheet_name)
                    sheet_path = f"xl/worksheets/sheet{sheet_idx}.xml"
                    if sheet_path not in zf.namelist():
                        continue

                    ws_root = DefusedET.fromstring(zf.read(sheet_path))
                    rows_data: List[Dict[str, Any]] = []
                    lines_data: Dict[int, int] = {}
                    headers: List[str] = []

                    row_elements = ws_root.findall("main:sheetData/main:row", ns)
                    for r_idx, row_elem in enumerate(row_elements):
                        row_no = int(row_elem.attrib.get("r", r_idx + 1))
                        cells = row_elem.findall("main:c", ns)
                        row_vals: List[str] = []

                        for c in cells:
                            t_attr = c.attrib.get("t")
                            v_elem = c.find("main:v", ns)
                            val = ""
                            if v_elem is not None and v_elem.text:
                                raw_v = v_elem.text
                                if t_attr == "s" and raw_v.isdigit() and int(raw_v) < len(shared_strings):
                                    val = shared_strings[int(raw_v)]
                                else:
                                    val = raw_v
                            row_vals.append(val.strip())

                        if not any(row_vals):
                            continue

                        if not headers:
                            headers = row_vals
                        else:
                            row_dict = {}
                            for h_idx, h_name in enumerate(headers):
                                row_dict[h_name] = row_vals[h_idx] if h_idx < len(row_vals) else ""
                            rows_data.append(row_dict)
                            lines_data[len(rows_data) - 1] = row_no

                    if rows_data:
                        tables[norm_step] = rows_data
                        source_lines[norm_step] = lines_data
        except Exception:
            pass

        return tables, source_lines

    # -------------------------------------------------------------------------
    # Condition Matching & Shadowing Engine
    # -------------------------------------------------------------------------
    @classmethod
    def matches_condition(cls, cond_val: Any, scenario_val: Any) -> bool:
        """Evaluates whether scenario property satisfies decision table cell condition."""
        cond = str(cond_val).strip() if cond_val is not None else ""
        scen = str(scenario_val).strip() if scenario_val is not None else ""

        # Blank or Asterisk matches ALL values
        if cond in ("*", "", "ALL"):
            return True

        # Exact case-insensitive match
        if cond.upper() == scen.upper():
            return True

        # Negation (!= X or <> X or NOT X)
        if cond.startswith("!=") or cond.startswith("<>"):
            neg = cond[2:].strip().upper()
            return scen.upper() != neg
        if cond.upper().startswith("NOT "):
            neg = cond[4:].strip().upper()
            return scen.upper() != neg

        # Set Inclusion (comma-separated or bracketed)
        if "," in cond:
            clean_items = {item.strip(" '\"[]").upper() for item in cond.split(",")}
            return scen.upper() in clean_items

        # Range matching: [1000..2000]
        range_match = re.match(r"\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]", cond)
        if range_match and scen.isdigit():
            low, high = int(range_match.group(1)), int(range_match.group(2))
            return low <= int(scen) <= high

        return False

    @classmethod
    def condition_subsumes(cls, cond_a: Any, cond_b: Any) -> bool:
        """
        Determines whether condition A mathematically covers/subsumes condition B.
        If True, any input that satisfies B is guaranteed to satisfy A.
        """
        a = str(cond_a).strip() if cond_a is not None else ""
        b = str(cond_b).strip() if cond_b is not None else ""

        # Catch-all wildcard subsumes everything
        if a in ("*", "", "ALL"):
            return True

        # Identical condition
        if a.upper() == b.upper():
            return True

        # Interval / numerical range subsumption: [low..high] or low..high
        range_a = re.match(r"^\[?\s*(\d+(?:\.\d+)?)\s*\.\.\s*(\d+(?:\.\d+)?)\s*\]?$", a)
        if range_a:
            a_low = float(range_a.group(1))
            a_high = float(range_a.group(2))
            if a_low > a_high:
                a_low, a_high = a_high, a_low

            # Case 1: cond_b is also an interval [b_low..b_high]
            range_b = re.match(r"^\[?\s*(\d+(?:\.\d+)?)\s*\.\.\s*(\d+(?:\.\d+)?)\s*\]?$", b)
            if range_b:
                b_low = float(range_b.group(1))
                b_high = float(range_b.group(2))
                if b_low > b_high:
                    b_low, b_high = b_high, b_low
                return a_low <= b_low and b_high <= a_high

            # Case 2: cond_b is a discrete numerical value
            clean_b = b.strip(" '\"")
            try:
                val_b = float(clean_b)
                return a_low <= val_b <= a_high
            except ValueError:
                pass

            # Case 3: cond_b is a comma-separated set of numbers, all within [a_low..a_high]
            if "," in b:
                try:
                    items = [float(item.strip(" '\"[]")) for item in b.split(",")]
                    return len(items) > 0 and all(a_low <= item <= a_high for item in items)
                except ValueError:
                    pass

        # Set subsumption
        if "," in a:
            set_a = {item.strip(" '\"[]").upper() for item in a.split(",")}
            if "," in b:
                set_b = {item.strip(" '\"[]").upper() for item in b.split(",")}
                return set_b.issubset(set_a)
            else:
                return b.upper() in set_a

        return False

    def _audit_shadowed_rules(
        self,
        tables: Dict[str, List[Dict[str, Any]]],
        source_lines: Dict[str, Dict[int, int]],
        artifact_path: str,
        artifact_hash: str,
    ) -> Tuple[int, List[Finding]]:
        """
        Audits decision tables for unreachable / shadowed rules where an earlier row
        subsumes a later row across all condition criteria.
        """
        findings: List[Finding] = []
        total_shadowed = 0

        for step, rows in tables.items():
            if not rows or len(rows) < 2:
                continue

            # Identify condition columns (COND_* or non-RESULT columns)
            first_row = rows[0]
            cond_cols = [k for k in first_row.keys() if k.startswith("COND_")]
            if not cond_cols:
                cond_cols = [k for k in first_row.keys() if k.upper() not in ("RESULT", "ACTION", "OUTPUT", "RETURN")]

            if not cond_cols:
                continue

            # Pairwise evaluation: check if earlier row i subsumes later row j
            shadowed_indices: Set[int] = set()

            for i in range(len(rows)):
                # If row i is itself shadowed, it cannot shadow downstream rules
                if i in shadowed_indices:
                    continue

                for j in range(i + 1, len(rows)):
                    if j in shadowed_indices:
                        continue

                    # Check if row i covers row j on ALL condition columns
                    is_subsumed = True
                    for col in cond_cols:
                        val_i = rows[i].get(col, "*")
                        val_j = rows[j].get(col, "*")
                        if not self.condition_subsumes(val_i, val_j):
                            is_subsumed = False
                            break

                    if is_subsumed:
                        shadowed_indices.add(j)
                        total_shadowed += 1
                        line_j = source_lines.get(step, {}).get(j, j + 2)
                        line_i = source_lines.get(step, {}).get(i, i + 2)

                        cond_snippet = ", ".join(f"{k}={v}" for k, v in rows[j].items())
                        shadow_finding = Finding(
                            rule_id="OPD_UNREACHABLE_RULE",
                            severity=Severity.MINOR,
                            category="Configuration Integrity",
                            title=f"Shadowed Rule in {step} Table",
                            description=(
                                f"Rule at row {j + 1} (line {line_j}) in table '{step}' is unreachable because "
                                f"earlier row {i + 1} (line {line_i}) subsumes all its condition criteria."
                            ),
                            confidence=ConfidenceClass.RULE_DERIVED,
                            confidence_score=0.85,
                            remediation=(
                                f"Reorder rules in table '{step}' so specific conditions precede broader catch-all wildcards, "
                                f"or eliminate redundant row {j + 1}."
                            ),
                            evidence=[
                                Evidence(
                                    artifact_path=f"{artifact_path}#{step}",
                                    line_number=line_j,
                                    snippet=cond_snippet,
                                    sha256=artifact_hash,
                                    provenance=ConfidenceClass.RULE_DERIVED,
                                    trust_score=0.85,
                                )
                            ],
                            technical_details={
                                "step": step,
                                "shadowedRowIndex": j + 1,
                                "shadowedLine": line_j,
                                "shadowingRowIndex": i + 1,
                                "shadowingLine": line_i,
                                "shadowedConditions": rows[j],
                                "shadowingConditions": rows[i],
                            },
                            affected_objects=[f"BRFPLUS_TABLE_{step.upper().replace(' ', '_')}"],
                        )
                        findings.append(shadow_finding)

        return total_shadowed, findings

    # -------------------------------------------------------------------------
    # Sequential Pipeline Execution
    # -------------------------------------------------------------------------
    def _execute_pipeline(
        self,
        tables: Dict[str, List[Dict[str, Any]]],
        scenario: Dict[str, str],
        source_lines: Dict[str, Dict[int, int]],
        artifact_path: str,
        artifact_hash: str,
        target_release: str,
        step_lines: Optional[Dict[str, int]] = None,
    ) -> Tuple[str, Dict[str, str], Optional[str], List[Finding], int]:
        """
        Executes sequential determination through canonical OPD steps.
        Halts and pinpoints on first determination failure.
        """
        if step_lines is None:
            step_lines = {}

        results: Dict[str, str] = {}
        first_failed_step: Optional[str] = None
        findings: List[Finding] = []
        rules_evaluated_count = 0

        if not tables and not scenario:
            return "COMPLETED", results, None, findings, 0

        for step in self.CANONICAL_STEPS:
            rows = tables.get(step, [])
            step_matched = False
            _matched_row_dict: Dict[str, Any] = {}
            matched_row_line: int = 1

            for idx, row in enumerate(rows):
                rules_evaluated_count += 1
                row_matches = True

                for col, val in row.items():
                    # Condition column detection
                    if col.startswith("COND_"):
                        field_name = col[5:]
                    elif col.upper() in ("RESULT", "ACTION", "OUTPUT", "RETURN"):
                        continue
                    else:
                        field_name = col

                    scen_val = scenario.get(field_name, "")
                    if not self.matches_condition(val, scen_val):
                        row_matches = False
                        break

                if row_matches:
                    step_matched = True
                    _matched_row_dict = row
                    matched_row_line = source_lines.get(step, {}).get(idx, idx + 2)

                    # Determine result value
                    res_val = row.get("RESULT") or row.get("Result") or row.get("OUTPUT") or ""
                    if not res_val:
                        # Fallback to step-specific result column
                        for k, v in row.items():
                            if k.upper() in (step.upper(), "VALUE", "TEMPLATE", "CHANNEL", "QUEUE"):
                                res_val = v
                                break
                    results[step] = res_val
                    break

            # Handle step match failure
            if not step_matched:
                first_failed_step = step
                # Identify missing condition details
                missing_cond = self._diagnose_missing_condition(step, scenario, rows)
                fail_line = step_lines.get(step, source_lines.get(step, {}).get(0, 1))
                fail_finding = Finding(
                    rule_id="OPD_DETERMINATION_STEP_MISSING",
                    severity=Severity.MAJOR if step in ("Output Type", "Channel") else Severity.CRITICAL,
                    category="Output Determination",
                    title=f"{step} Determination Failed",
                    description=(
                        f"Output determination stalled at step '{step}'. No decision table rule matched the document scenario: {missing_cond}"
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Add a decision table entry in BRFplus table '{step}' matching the document parameters, "
                        f"or configure a fallback rule with wildcard ('*') criteria."
                    ),
                    evidence=[
                        Evidence(
                            artifact_path=f"{artifact_path}#{step}",
                            line_number=fail_line,
                            snippet=f"Step '{step}' evaluated against scenario: {json.dumps(scenario)}",
                            sha256=artifact_hash,
                            provenance=ConfidenceClass.VERIFIED,
                            trust_score=1.0,
                        )
                    ],
                    technical_details={
                        "step": step,
                        "scenario": scenario,
                        "missingCondition": missing_cond,
                        "totalRulesInTable": len(rows),
                        "legacyRuleId": "OPD_STEP_FAILED",
                    },
                    affected_objects=[f"OPD_STEP_{step.upper().replace(' ', '_')}"],
                )
                findings.append(fail_finding)
                break

            # Post-match specific validations for Channel, Printer, Relevance
            if step == "Channel":
                determined_channel = results.get("Channel", "").upper()
                if determined_channel and determined_channel not in self.VALID_CHANNELS:
                    findings.append(
                        Finding(
                            rule_id="OPD_CHANNEL_INACTIVE",
                            severity=Severity.CRITICAL,
                            category="Channel Governance",
                            title=f"Inactive or Unsupported Output Channel '{determined_channel}'",
                            description=(
                                f"Determined channel '{determined_channel}' is inactive or unsupported in target release {target_release}."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=f"Update Channel decision table to output a supported channel ({', '.join(sorted(self.VALID_CHANNELS))}).",
                            evidence=[
                                Evidence(
                                    artifact_path=f"{artifact_path}#Channel",
                                    line_number=matched_row_line,
                                    snippet=f"Channel: {determined_channel}",
                                    sha256=artifact_hash,
                                    provenance=ConfidenceClass.VERIFIED,
                                    trust_score=1.0,
                                )
                            ],
                            technical_details={"channel": determined_channel, "targetRelease": target_release},
                        )
                    )

            if step == "Printer":
                channel = results.get("Channel", "").upper()
                printer_queue = results.get("Printer", "").strip()
                if channel == "PRINT" and not printer_queue:
                    findings.append(
                        Finding(
                            rule_id="OPD_PRINTER_QUEUE_NOT_FOUND",
                            severity=Severity.MAJOR,
                            category="Print Architecture",
                            title="Print Queue Not Found for PRINT Channel",
                            description=(
                                "Output Channel evaluated to 'PRINT', but Printer / Print Queue determination resolved to empty."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation="Maintain a valid Print Queue (e.g. LP01 or SAP Cloud Print Queue) in the Printer step.",
                            evidence=[
                                Evidence(
                                    artifact_path=f"{artifact_path}#Printer",
                                    line_number=matched_row_line,
                                    snippet=f"Printer result: '{printer_queue}' for PRINT channel",
                                    sha256=artifact_hash,
                                    provenance=ConfidenceClass.VERIFIED,
                                    trust_score=1.0,
                                )
                            ],
                            technical_details={"channel": channel, "printerQueue": printer_queue},
                        )
                    )

            if step == "Output Relevance":
                relevance_val = results.get("Output Relevance", "").strip().upper()
                if relevance_val in ("FALSE", "0", "NO", "N"):
                    findings.append(
                        Finding(
                            rule_id="OPD_RELEVANCE_SUPPRESSED",
                            severity=Severity.INFO,
                            category="Output Determination",
                            title="Document Output Generation Suppressed by Relevance Rule",
                            description=(
                                "All prior determination steps succeeded, but Output Relevance rule evaluated to FALSE. Document output is intentionally suppressed."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation="Verify if document status or change indicator intentionally suppresses output.",
                            evidence=[
                                Evidence(
                                    artifact_path=f"{artifact_path}#Output Relevance",
                                    line_number=matched_row_line,
                                    snippet=f"Output Relevance: {relevance_val}",
                                    sha256=artifact_hash,
                                    provenance=ConfidenceClass.VERIFIED,
                                    trust_score=1.0,
                                )
                            ],
                            technical_details={"outputRelevance": relevance_val},
                        )
                    )

        pipeline_status = "COMPLETED" if not first_failed_step else "PARTIAL"
        return pipeline_status, results, first_failed_step, findings, rules_evaluated_count

    def _diagnose_missing_condition(
        self, step: str, scenario: Dict[str, str], rows: List[Dict[str, Any]]
    ) -> str:
        """Constructs an explanatory diagnostic message identifying missing scenario keys."""
        if not rows:
            return f"Decision table '{step}' contains zero configured rules."

        sample_row = rows[0]
        cond_fields = []
        for col in sample_row.keys():
            if col.startswith("COND_"):
                cond_fields.append(col[5:])
            elif col.upper() not in ("RESULT", "ACTION", "OUTPUT", "RETURN"):
                cond_fields.append(col)

        mismatches = [f"{field}='{scenario.get(field, 'MISSING')}'" for field in cond_fields]
        return f"No row matching condition ({', '.join(mismatches)}) in step '{step}'."
