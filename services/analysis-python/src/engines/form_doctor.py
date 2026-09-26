"""
ERP Preflight — FormDoctor Engine
SAPscript, Smart Forms to Adobe Forms (XDP) Migration & Data Path Validator
"""

from typing import Dict, Any, List, Optional, Tuple
import re
from xml.etree.ElementTree import Element, TreeBuilder
import defusedxml.ElementTree as DefusedET
from defusedxml.common import DefusedXmlException, EntitiesForbidden, DTDForbidden

from src.core.base_engine import BaseEngine
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, RuleSpec, insufficient, rule_catalog,
)
from src.core.registry import register_engine
from src.core.exceptions import EngineInputError, SecurityViolationError
from src.models.enums import EngineType, ArtifactType, AnalysisStatus, Severity, ConfidenceClass
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.platform.evidence import EvidenceEngine


# Shared defused, depth-bounded XML parser with line/column retention.
from src.parsers.safe_xml import LineElement, SafeXmlParser  # noqa: E402


# ==== ENGINE CONTRACT (rule catalog + input contract) ====
RULES = rule_catalog(
    RuleSpec(
        "FORM_FIELD_HIDDEN_IN_LAYOUT", "Bound field hidden in layout", Severity.MINOR,
        "In Adobe LiveCycle Designer set the field's Presence to 'Visible' (Object > Field) if it must print; "
        "otherwise document the intentional suppression.", "Layout Visibility",
    ),
    RuleSpec(
        "FORM_BINDING_PATH_MISMATCH", "Field binding path does not match runtime XML", Severity.MAJOR,
        "Update the field's Binding > Data Binding (dataRef) in the XDP template to the suggested runtime XML "
        "path, or align the form interface / CDS data provider so the element appears at the bound path.",
        "Data Binding",
    ),
    RuleSpec(
        "FORM_FIELD_MISSING_IN_XML", "Bound field absent from runtime XML", Severity.CRITICAL,
        "Expose the element in the form's data provider (extend the CDS view / Gateway form data service used "
        "by Output Management) or remove the unbacked binding from the XDP template.", "Data Binding",
    ),
    RuleSpec(
        "FORM_LEGACY_SMARTFORM_DETECTED", "Legacy Smart Form detected", Severity.CRITICAL,
        "Smart Forms are unsupported in S/4HANA Cloud Public Edition. Rebuild the layout as an Adobe Form "
        "(XDP) on a released form data provider, or adopt the SAP-delivered output form template.",
        "Clean Core Extensibility",
    ),
    RuleSpec(
        "FORM_LEGACY_SAPSCRIPT_DETECTED", "Legacy SAPscript detected", Severity.CRITICAL,
        "SAPscript is not available in ABAP Cloud / S/4HANA Cloud. Redesign the document as an Adobe Form "
        "(XDP) using Output Management (BRFplus determination) or use the SAP-delivered form template.",
        "Clean Core Extensibility",
    ),
)


def _form_text_check(text: str) -> Optional[str]:
    patterns = FormDoctorEngine.SAPSCRIPT_PATTERNS + FormDoctorEngine.SMARTFORM_PATTERNS
    if any(p.search(text) for p, _ in patterns):
        return None
    return "text payload is not a SAPscript / Smart Forms source (no legacy form markers found)."


class FormConfigModel(ContractModel):
    """Structured FormDoctor input passed through request.configuration."""
    signal_fields = ("xdp_content", "xml_content", "bindings")
    signal_message = "FormDoctor requires 'xdp_content' + 'xml_content' (or explicit 'bindings')."
    xdp_content: Optional[str] = None
    xml_content: Optional[str] = None
    bindings: Optional[List[Dict[str, Any]]] = None


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.XML, InputFormat.TEXT),
    summary=(
        "Adobe Form XDP template together with the form's runtime data XML (as two artifacts, or data XML in "
        "raw_content + configuration.xdp_content), or a SAPscript / Smart Forms source (XML export or text)."
    ),
    required=(
        "XDP template AND runtime data XML (binding verification)",
        "or a SAPscript / Smart Forms source (legacy form audit)",
    ),
    json_model=FormConfigModel,
    text_check=_form_text_check,
)


# ==== END ENGINE CONTRACT ====


@register_engine
class FormDoctorEngine(BaseEngine):
    engine_type = EngineType.FORM_DOCTOR
    rule_prefix = "FORM"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    name = "FormDoctor"
    description = "SAPscript, Smart Forms to Adobe Forms (XDP) migration & syntax validator"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.XML, ArtifactType.XDP, ArtifactType.TXT]

    # Legacy form detection patterns for Clean Core Tier 2/3 assessment
    SAPSCRIPT_PATTERNS = [
        (re.compile(r"^/:\s+[A-Z_-]+", re.MULTILINE), "SAPscript Command Line (/:)"),
        (re.compile(r"^/\*\s+", re.MULTILINE), "SAPscript Comment Line (/*)"),
        (re.compile(r"^/=\s+", re.MULTILINE), "SAPscript Continuation Line (/=)"),
        (re.compile(r"\bADDRESS\b[\s\S]+?\bENDADDRESS\b", re.IGNORECASE), "SAPscript ADDRESS Routine"),
        (re.compile(r"/:[\s\t]*DEFINE\s+&[A-Z0-9_-]+&", re.IGNORECASE), "SAPscript Symbol Definition (&...&)"),
        (re.compile(r"/:[\s\t]*INCLUDE\s+&[A-Z0-9_-]+&", re.IGNORECASE), "SAPscript INCLUDE Statement"),
        (re.compile(r"/:[\s\t]*SET\s+COUNTRY", re.IGNORECASE), "SAPscript Country Specific Setting"),
        (re.compile(r"/:[\s\t]*NEW-PAGE", re.IGNORECASE), "SAPscript Page Break Command"),
    ]

    SMARTFORM_PATTERNS = [
        (re.compile(r"<smartform\b", re.IGNORECASE), "SmartForms XML Root (<smartform>)"),
        (re.compile(r"<\?smartform\b", re.IGNORECASE), "SmartForms PI Tag"),
        (re.compile(r"CALL\s+FUNCTION\s+['\"]SSF_FUNCTION_MODULE_NAME['\"]", re.IGNORECASE), "SmartForms Driver Call"),
        (re.compile(r"CALL\s+FUNCTION\s+['\"]/1BCDWB/SF[0-9]+['\"]", re.IGNORECASE), "Generated SmartForm Function Call"),
        (re.compile(r"(?:^|[\s<>])(%PAGE|%WINDOW|%TEXT)\b", re.IGNORECASE), "SmartForms Internal Elements"),
    ]

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        findings: List[Finding] = []
        rules_evaluated = 0
        artifacts_scanned = max(1, len(request.artifacts))

        # 1. Parse Input Artifacts (XML Payload, XDP Template, Explicit Bindings, Legacy Text)
        xml_content, xdp_content, raw_bindings, xml_path, xdp_path = self._extract_payloads(request)

        # 2. Check for Clean Core Tier 2/3 Legacy Forms (SAPscript / SmartForms)
        legacy_findings = self._audit_legacy_forms(xml_content, xdp_content, xml_path, request.target_release)
        findings.extend(legacy_findings)
        rules_evaluated += 5

        # 3. Input contract: a binding verdict needs BOTH a template (XDP or explicit bindings) and the
        #    runtime data XML. A legacy SAPscript / Smart Forms source is analysable on its own.
        prefix = self.rule_prefix
        is_legacy_source = bool(legacy_findings) and not xdp_content and not raw_bindings
        if is_legacy_source:
            return AnalysisResponse(
                job_id=request.job_id,
                engine_type=self.engine_type,
                status=AnalysisStatus.COMPLETED,
                findings=findings,
                metrics=AnalysisMetrics(rules_evaluated=rules_evaluated, artifacts_scanned=artifacts_scanned),
            )
        has_template = bool(xdp_content) or bool(raw_bindings)
        has_data_xml = bool(xml_content) and xml_content.strip().startswith("<")
        if not has_template and not has_data_xml:
            if xml_content.strip():
                raise EngineInputError(
                    f"{prefix}_INVALID_INPUT",
                    "Text payload is neither a SAPscript / Smart Forms source nor an XML document; "
                    "no form artifact could be recognised.",
                )
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "No form artifact supplied: provide an Adobe Form XDP template plus its runtime data XML, "
                "or a SAPscript / Smart Forms source.",
            )
        if has_template and not has_data_xml:
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "An Adobe Form template was supplied without the runtime data XML; field bindings cannot be "
                "verified. Upload the form's data XML (e.g. from the print preview / ADS trace) as well.",
            )
        if has_data_xml and not has_template:
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "Runtime data XML was supplied without the Adobe Form XDP template (or explicit bindings); "
                "there are no field bindings to verify against it.",
            )

        # 4. Parse XML Runtime Payload DOM and build path coordinate index
        xml_paths: Dict[str, int] = {}
        xml_snippets: Dict[str, str] = {}
        xml_hash = EvidenceEngine.compute_sha256(xml_content) if xml_content else ""

        should_parse_xml = (
            bool(xml_content)
            and xml_content.strip().startswith("<")
            and not xml_content.strip().startswith("<?smartform")
        )

        if should_parse_xml:
            try:
                xml_root = self._safe_parse_xml(xml_content)
            except SecurityViolationError:
                raise EngineInputError(
                    f"{prefix}_INVALID_INPUT",
                    "Malicious XML rejected in runtime data XML (Entities/DTD forbidden).",
                ) from None
            except ValueError as e:
                raise EngineInputError(f"{prefix}_PARSE_ERROR", f"Runtime data XML: {e}") from None
            self._index_xml_paths(xml_root, xml_content, xml_paths, xml_snippets)
            rules_evaluated += 5

        # 5. Extract Bindings from XDP Template or Explicit Bindings List
        bindings_to_check: List[Dict[str, Any]] = []
        xdp_hash = EvidenceEngine.compute_sha256(xdp_content) if xdp_content else ""

        if xdp_content:
            try:
                xdp_root = self._safe_parse_xml(xdp_content)
            except SecurityViolationError:
                raise EngineInputError(
                    f"{prefix}_INVALID_INPUT",
                    "Malicious XML rejected in Adobe Form XDP template (Entities/DTD forbidden).",
                ) from None
            except ValueError as e:
                raise EngineInputError(
                    f"{prefix}_PARSE_ERROR",
                    f"Adobe Form XDP template is not well-formed: {e} Re-export it from Adobe LiveCycle Designer.",
                ) from None
            extracted_bindings = self._extract_xdp_bindings(xdp_root, xdp_content)
            bindings_to_check.extend(extracted_bindings)
            rules_evaluated += len(extracted_bindings)

        # Add explicit bindings from request options/configuration
        if raw_bindings:
            bindings_to_check.extend(raw_bindings)
            rules_evaluated += len(raw_bindings)

        if not bindings_to_check:
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "The Adobe Form template contains no <bind match=\"dataRef\" ref=...> field bindings; "
                "there is nothing to verify against the runtime data XML.",
            )

        # 6. Evaluate Bindings Against XML Path Tree
        binding_findings, valid_count, broken_count = self._verify_bindings(
            bindings=bindings_to_check,
            xml_paths=xml_paths,
            xml_snippets=xml_snippets,
            xml_path=xml_path,
            xml_hash=xml_hash,
            xdp_path=xdp_path,
            xdp_hash=xdp_hash,
        )
        findings.extend(binding_findings)

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=AnalysisMetrics(
                rules_evaluated=max(rules_evaluated, 1),
                artifacts_scanned=artifacts_scanned,
                additional_metrics={
                    "totalBindingsChecked": len(bindings_to_check),
                    "validBindings": valid_count,
                    "brokenBindings": broken_count,
                },
            ),
        )

    # -------------------------------------------------------------------------
    # Hardened Safe XML Parser with Coordinate Retention
    # -------------------------------------------------------------------------
    @classmethod
    def _safe_parse_xml(cls, xml_text: str) -> LineElement:
        """Raises SecurityViolationError (DTD/entities) or ValueError (syntax / depth)."""
        return SafeXmlParser.parse_string(xml_text)

    # -------------------------------------------------------------------------
    # Ingestion & Extraction Helper
    # -------------------------------------------------------------------------
    def _extract_payloads(
        self, request: AnalysisRequest
    ) -> Tuple[str, str, List[Dict[str, Any]], str, str]:
        xml_content = ""
        xdp_content = ""
        raw_bindings: List[Dict[str, Any]] = []
        xml_path = "invoice_payload.xml"
        xdp_path = "invoice_template.xdp"

        # Check configuration
        if isinstance(request.configuration.get("bindings"), list):
            raw_bindings = request.configuration["bindings"]
        if request.configuration.get("xml_content"):
            xml_content = request.configuration["xml_content"]
        if request.configuration.get("xdp_content"):
            xdp_content = request.configuration["xdp_content"]

        # Check raw_content
        raw = request.raw_content or ""
        if raw.strip():
            if "<xdp:xdp" in raw or "<template" in raw or raw.strip().endswith(".xdp"):
                xdp_content = raw
                xdp_path = request.artifact_s3_key or "template.xdp"
            elif any(k in raw.lower() for k in ("<smartform", "/:", "/*", "/=", "address", "ssf_function_module_name")):
                xml_content = raw
                xml_path = request.artifact_s3_key or "legacy_form.txt"
            elif request.artifact_type == ArtifactType.TXT:
                xml_content = raw
                xml_path = request.artifact_s3_key or "legacy_form.txt"
            elif raw.strip().startswith("<"):
                xml_content = raw
                xml_path = request.artifact_s3_key or "payload.xml"

        # Check artifacts list
        for art in request.artifacts:
            art_name = art.file_name or ""
            content = art.raw_content or ""
            if not content:
                continue
            if art_name.endswith(".xdp") or art.artifact_type == ArtifactType.XDP or "<xdp:xdp" in content:
                xdp_content = content
                xdp_path = art_name
            elif art_name.endswith(".xml") or art.artifact_type == ArtifactType.XML or (content.strip().startswith("<") and "<xdp:xdp" not in content):
                xml_content = content
                xml_path = art_name
            elif art_name.endswith(".txt") or art.artifact_type == ArtifactType.TXT:
                xml_content = content
                xml_path = art_name

        return xml_content, xdp_content, raw_bindings, xml_path, xdp_path

    # -------------------------------------------------------------------------
    # XML DOM Indexing
    # -------------------------------------------------------------------------
    def _index_xml_paths(
        self, root: LineElement, xml_text: str, path_map: Dict[str, int], snippet_map: Dict[str, str]
    ) -> None:
        """
        Recursively indexes all XML paths to their 1-indexed line numbers and snippets.
        Normalizes XML tags by stripping namespace prefixes for flexible path matching.
        """
        lines = xml_text.splitlines()

        def strip_ns(tag: str) -> str:
            return tag.split("}")[-1] if "}" in tag else tag

        def traverse(elem: LineElement, current_path: str):
            tag_name = strip_ns(elem.tag)
            path = f"{current_path}.{tag_name}" if current_path else f"$.{tag_name}"
            line_no = getattr(elem, "sourceline", 1)
            path_map[path] = line_no
            if 0 < line_no <= len(lines):
                snippet_map[path] = lines[line_no - 1].strip()

            for child in elem:
                if isinstance(child, LineElement):
                    traverse(child, path)

        traverse(root, "")

    # -------------------------------------------------------------------------
    # Adobe Form XDP Binding Extraction
    # -------------------------------------------------------------------------
    def _extract_xdp_bindings(self, xdp_root: LineElement, xdp_text: str) -> List[Dict[str, Any]]:
        """
        Traverses Adobe LiveCycle Designer XDP structure, tracking subform scopes and extracting
        <field> <bind match="dataRef" ref="..."/> declarations with exact line coordinates.
        """
        lines = xdp_text.splitlines()
        bindings: List[Dict[str, Any]] = []

        def strip_ns(tag: str) -> str:
            return tag.split("}")[-1] if "}" in tag else tag

        def traverse_xdp(elem: LineElement, current_scope: str):
            tag = strip_ns(elem.tag)

            # Update subform scope
            next_scope = current_scope
            if tag == "subform":
                subform_data_ref = elem.attrib.get("dataRef") or elem.attrib.get("ref")
                if subform_data_ref:
                    # Clean scope
                    clean_ref = subform_data_ref.strip()
                    if clean_ref.startswith("$."):
                        next_scope = clean_ref
                    elif clean_ref.startswith("$"):
                        next_scope = f"$.{clean_ref[1:].lstrip('.')}"
                    else:
                        next_scope = f"{current_scope}.{clean_ref}" if current_scope else f"$.{clean_ref}"

            if tag == "field":
                field_name = elem.attrib.get("name", "UnnamedField")
                field_presence = elem.attrib.get("presence", "visible")
                field_line = getattr(elem, "sourceline", 1)
                field_col = getattr(elem, "sourcecolumn", 0)

                # Find child <bind match="dataRef" ...>
                for child in elem:
                    child_tag = strip_ns(child.tag)
                    if child_tag == "bind":
                        ref = child.attrib.get("ref", "")
                        bind_line = getattr(child, "sourceline", field_line)
                        bind_col = getattr(child, "sourcecolumn", field_col)

                        # Construct effective target path
                        target_path = self._resolve_target_path(next_scope, ref)
                        snippet = lines[bind_line - 1].strip() if 0 < bind_line <= len(lines) else ""

                        bindings.append({
                            "field": field_name,
                            "dataRef": target_path,
                            "raw_ref": ref,
                            "presence": field_presence,
                            "line": bind_line,
                            "column": bind_col,
                            "snippet": snippet,
                        })

            for child in elem:
                if isinstance(child, LineElement):
                    traverse_xdp(child, next_scope)

        traverse_xdp(xdp_root, "")
        return bindings

    @staticmethod
    def _resolve_target_path(scope: str, ref: str) -> str:
        """Resolves relative and absolute XFA dataRef expressions against enclosing subform scope."""
        clean_ref = ref.strip()
        if not clean_ref:
            return scope or "$."

        # If ref is already fully qualified from root (e.g. $.Invoice.Header.InvoiceID)
        if clean_ref.startswith("$."):
            # Check if scope already starts with the same root
            if scope and clean_ref.startswith(scope):
                return clean_ref
            # If scope is $.Invoice and ref is $.Header.InvoiceID, combine them: $.Invoice.Header.InvoiceID
            if scope and scope != "$." and not clean_ref.startswith(f"{scope}."):
                tail = clean_ref[2:]  # Strip '$.'
                return f"{scope}.{tail}"
            return clean_ref

        # If relative path
        if scope:
            return f"{scope}.{clean_ref.lstrip('.')}"
        return f"$.{clean_ref.lstrip('.')}"

    # -------------------------------------------------------------------------
    # Binding Verification Logic
    # -------------------------------------------------------------------------
    def _verify_bindings(
        self,
        bindings: List[Dict[str, Any]],
        xml_paths: Dict[str, int],
        xml_snippets: Dict[str, str],
        xml_path: str,
        xml_hash: str,
        xdp_path: str,
        xdp_hash: str,
    ) -> Tuple[List[Finding], int, int]:
        findings: List[Finding] = []
        valid_count = 0
        broken_count = 0

        for binding in bindings:
            field_name = binding.get("field", "UnknownField")
            target_path = binding.get("dataRef", "")
            is_hidden = binding.get("presence") in ("hidden", "invisible")
            bind_line = binding.get("line", 1)
            bind_col = binding.get("column", 0)
            bind_snippet = binding.get("snippet") or f'<bind match="dataRef" ref="{target_path}"/>'

            # 1. Check for layout suppression
            if is_hidden:
                findings.append(
                    Finding(
                        rule_id="FORM_FIELD_HIDDEN_IN_LAYOUT",
                        severity=Severity.MINOR,
                        category="Layout Visibility",
                        title=f"Field '{field_name}' Hidden in Layout",
                        description=(
                            f"Field '{field_name}' bound to '{target_path}' is configured with presence='hidden' "
                            f"or 'invisible', suppressing output display on printed/PDF documents."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation="Change field presence attribute to 'visible' in Adobe LiveCycle Designer if required on output.",
                        evidence=[
                            Evidence(
                                artifact_path=xdp_path,
                                line_number=bind_line,
                                column_number=bind_col,
                                snippet=bind_snippet,
                                sha256=xdp_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={"field": field_name, "dataRef": target_path, "presence": binding.get("presence")},
                    )
                )

            # 2. Check if path exists in XML
            if target_path in xml_paths:
                valid_count += 1
                continue

            broken_count += 1
            # Search for candidate path mismatches (leaf element or suffix match)
            leaf_tag = target_path.split(".")[-1]
            candidates = [p for p in xml_paths.keys() if p.endswith(f".{leaf_tag}")]

            # Also check case-insensitive match
            if not candidates:
                candidates = [p for p in xml_paths.keys() if p.split(".")[-1].upper() == leaf_tag.upper()]

            if candidates:
                suggested_path = candidates[0]
                xml_line = xml_paths.get(suggested_path, 1)
                xml_snip = xml_snippets.get(suggested_path, f"<{leaf_tag}>")

                findings.append(
                    Finding(
                        rule_id="FORM_BINDING_PATH_MISMATCH",
                        severity=Severity.MAJOR,
                        category="Data Binding",
                        title=f"Mismatched Field Binding Path for '{field_name}'",
                        description=(
                            f"Field '{field_name}' binds to '{target_path}', but the element exists in runtime XML at '{suggested_path}'."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=f"Update Adobe Form template dataRef for '{field_name}' from '{target_path}' to '{suggested_path}'.",
                        evidence=[
                            Evidence(
                                artifact_path=xdp_path,
                                line_number=bind_line,
                                column_number=bind_col,
                                snippet=bind_snippet,
                                sha256=xdp_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            ),
                            Evidence(
                                artifact_path=xml_path,
                                line_number=xml_line,
                                snippet=xml_snip,
                                sha256=xml_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            ),
                        ],
                        technical_details={
                            "field": field_name,
                            "currentBinding": target_path,
                            "suggestedBinding": suggested_path,
                            "xdpLine": bind_line,
                            "xmlLine": xml_line,
                        },
                    )
                )
            else:
                findings.append(
                    Finding(
                        rule_id="FORM_FIELD_MISSING_IN_XML",
                        severity=Severity.CRITICAL,
                        category="Data Binding",
                        title=f"Field '{field_name}' Missing in Runtime XML",
                        description=(
                            f"Adobe Form template binds field '{field_name}' to path '{target_path}', "
                            f"but this element is completely absent in the runtime XML payload."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Extend the underlying CDS view or print program to expose '{leaf_tag}' "
                            f"in the form interface data provider, or remove the unbacked binding."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=xdp_path,
                                line_number=bind_line,
                                column_number=bind_col,
                                snippet=bind_snippet,
                                sha256=xdp_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={"field": field_name, "dataRef": target_path, "missingLeaf": leaf_tag},
                    )
                )

        return findings, valid_count, broken_count

    # -------------------------------------------------------------------------
    # Clean Core Tier 2/3 Legacy Form Audit (SAPscript / SmartForms)
    # -------------------------------------------------------------------------
    def _audit_legacy_forms(
        self, xml_content: str, xdp_content: str, source_path: str, target_release: str
    ) -> List[Finding]:
        findings: List[Finding] = []
        combined_text = f"{xml_content}\n{xdp_content}"
        if not combined_text.strip():
            return findings

        sha256_hash = EvidenceEngine.compute_sha256(combined_text)
        is_cloud_target = any(cloud_pfx in target_release.upper() for cloud_pfx in ("CLOUD", "S4HC", "2402", "2408", "2502"))

        # Scan for SmartForms
        for pattern, desc in self.SMARTFORM_PATTERNS:
            match = pattern.search(combined_text)
            if match:
                line_no = combined_text[: match.start()].count("\n") + 1
                matched_snippet = match.group(0)
                findings.append(
                    Finding(
                        rule_id="FORM_LEGACY_SMARTFORM_DETECTED",
                        severity=Severity.BLOCKER if is_cloud_target else Severity.CRITICAL,
                        category="Clean Core Extensibility",
                        title="Legacy Smart Form Detected (Clean Core Tier 2 Violation)",
                        description=(
                            f"Artifact contains SAP Smart Forms technology ({desc}). Smart Forms are not supported "
                            f"in SAP S/4HANA Cloud Public Edition and constitute a Clean Core Tier 2/3 legacy migration blocker."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            "Migrate form layout and logic to Adobe Document Services (XDP) or S/4HANA Output Management "
                            "standard form templates using released OData/CDS interfaces."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=source_path,
                                line_number=line_no,
                                snippet=matched_snippet,
                                sha256=sha256_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "technology": "SAP Smart Forms",
                            "patternDescription": desc,
                            "cleanCoreTier": "TIER_2_TRANSITIONAL",
                            "targetRelease": target_release,
                        },
                        affected_objects=["SMARTFORM_LEGACY_OBJECT"],
                    )
                )
                break

        # Scan for SAPscript
        for pattern, desc in self.SAPSCRIPT_PATTERNS:
            match = pattern.search(combined_text)
            if match:
                line_no = combined_text[: match.start()].count("\n") + 1
                matched_snippet = match.group(0)
                findings.append(
                    Finding(
                        rule_id="FORM_LEGACY_SAPSCRIPT_DETECTED",
                        severity=Severity.BLOCKER if is_cloud_target else Severity.CRITICAL,
                        category="Clean Core Extensibility",
                        title="Legacy SAPscript Form Detected (Clean Core Tier 3 Violation)",
                        description=(
                            f"Artifact contains classic SAPscript ITF commands ({desc}). SAPscript is obsolete, "
                            f"strictly prohibited in S/4HANA Cloud, and represents an immediate upgrade blocker."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            "Redesign document layout as an Adobe Form (XDP) or adopt SAP S/4HANA standard pre-delivered "
                            "output form templates."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=source_path,
                                line_number=line_no,
                                snippet=matched_snippet,
                                sha256=sha256_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "technology": "SAPscript (ITF)",
                            "patternDescription": desc,
                            "cleanCoreTier": "TIER_3_PROHIBITED",
                            "targetRelease": target_release,
                        },
                        affected_objects=["SAPSCRIPT_LEGACY_OBJECT"],
                    )
                )
                break

        return findings
