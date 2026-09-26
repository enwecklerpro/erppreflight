"""Snapshot-derived released-object list supplied by the SaaS API (knowledge graph, Part 04 / Part 17.3).

The analysis service stays stateless: it never reads the knowledge database. For
CLEAN_CORE_OBJECT_GUARD the API classifies the object names referenced by an
artifact against the latest immutable knowledge snapshot (official SAP
Cloudification Repository) and passes the result in
``configuration.released_objects``:

.. code-block:: json

    {
      "schemaVersion": 1,
      "snapshotId": "<uuid>", "snapshotSeq": 3, "contentSha256": "<hex>",
      "source": "SAP_CLOUDIFICATION_REPOSITORY",
      "release": {"productCode": "SAP_S4HANA", "editionCode": "CLOUD_PRIVATE", "releaseCode": "2023 FPS03",
                  "label": "SAP S/4HANA 2023 FPS03", "exactMatch": true},
      "objects": [
        {"objectType": "TABL", "objectName": "MARA", "state": "notToBeReleased",
         "classicApiState": null, "cleanCoreLevel": null, "successorConcept": null,
         "successors": [{"objectType": "CDS_STOB", "objectName": "I_PRODUCT"}]}
      ]
    }

``objectType`` uses the repository types (TABL, CDS_STOB, FUNC, CLAS, INTF, BDEF, ...).
``state`` is the raw repository state (released, deprecated, notToBeReleased,
notToBeReleasedStable) or null when the object is only classified as a classic
API (``classicApiState``: classicAPI | noAPI).

Parsing is strict (Pydantic); an invalid payload is ignored as a whole so the
engine falls back to its built-in curated list rather than analysing with
half-parsed knowledge.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, FrozenSet, List, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

CONFIG_KEYS = ("released_objects", "releasedObjects")

RELEASED_STATES = frozenset({"released", "deprecated"})
NOT_RELEASED_STATES = frozenset({"notToBeReleased", "notToBeReleasedStable", "noAPI"})

# Repository object type -> engine object family
CDS_TYPES = frozenset({"CDS_STOB", "DDLS"})
FUNCTION_TYPES = frozenset({"FUNC"})
CLASS_TYPES = frozenset({"CLAS", "INTF"})
TABLE_TYPES = frozenset({"TABL"})


class SuccessorRef(BaseModel):
    model_config = ConfigDict(extra="ignore")
    objectType: str = Field(min_length=1, max_length=20)
    objectName: str = Field(min_length=1, max_length=200)


class SnapshotObject(BaseModel):
    model_config = ConfigDict(extra="ignore")
    objectType: str = Field(min_length=1, max_length=20)
    objectName: str = Field(min_length=1, max_length=200)
    state: Optional[str] = Field(default=None, max_length=40)
    classicApiState: Optional[str] = Field(default=None, max_length=40)
    cleanCoreLevel: Optional[str] = Field(default=None, max_length=2)
    successorConcept: Optional[str] = Field(default=None, max_length=300)
    successors: List[SuccessorRef] = Field(default_factory=list, max_length=200)


class SnapshotRelease(BaseModel):
    model_config = ConfigDict(extra="ignore")
    productCode: Optional[str] = None
    editionCode: Optional[str] = None
    releaseCode: Optional[str] = None
    label: Optional[str] = None
    exactMatch: Optional[bool] = None


class ReleasedObjectList(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: int = 1
    snapshotId: str = Field(min_length=1, max_length=100)
    snapshotSeq: Optional[int] = None
    contentSha256: Optional[str] = Field(default=None, max_length=64)
    source: str = Field(min_length=1, max_length=100)
    release: Optional[SnapshotRelease] = None
    objects: List[SnapshotObject] = Field(default_factory=list, max_length=20000)


def parse_released_objects(configuration: Optional[Dict[str, Any]]) -> Optional[ReleasedObjectList]:
    """Returns the validated released-object list from an analysis configuration, or None."""
    if not configuration:
        return None
    for key in CONFIG_KEYS:
        raw = configuration.get(key)
        if raw is None:
            continue
        try:
            return ReleasedObjectList.model_validate(raw)
        except ValidationError:
            return None
    return None


def successor_text(obj: SnapshotObject) -> str:
    names = [s.objectName.upper() for s in obj.successors]
    if names:
        return ", ".join(sorted(names))
    if obj.successorConcept:
        return f"concept {obj.successorConcept}"
    return ""


@dataclass(frozen=True)
class SnapshotIndex:
    """Released / not-released sets derived from a snapshot list, keyed by upper-case object name."""

    snapshot_id: str
    source: str
    release_label: Optional[str]
    released_cds: FrozenSet[str]
    released_fms: FrozenSet[str]
    released_classes: FrozenSet[str]
    released_tables: FrozenSet[str]
    not_released_cds: Dict[str, str]
    not_released_fms: Dict[str, str]
    not_released_classes: Dict[str, str]
    not_released_tables: Dict[str, str]
    names: FrozenSet[str]


def build_snapshot_index(lst: ReleasedObjectList) -> SnapshotIndex:
    rel: Dict[str, set] = {"cds": set(), "fm": set(), "class": set(), "table": set()}
    nrel: Dict[str, Dict[str, str]] = {"cds": {}, "fm": {}, "class": {}, "table": {}}
    names: set = set()
    for o in sorted(lst.objects, key=lambda x: (x.objectType, x.objectName)):
        t = o.objectType.upper()
        family = (
            "cds" if t in CDS_TYPES else "fm" if t in FUNCTION_TYPES else "class" if t in CLASS_TYPES
            else "table" if t in TABLE_TYPES else None
        )
        if family is None:
            continue
        state = o.state if o.state is not None else o.classicApiState
        if state is None:
            continue
        name = o.objectName.upper()
        if state in RELEASED_STATES:
            rel[family].add(name)
            names.add(name)
        elif state in NOT_RELEASED_STATES or state == "classicAPI":
            # Classic APIs (clean core level B) are still not released for ABAP Cloud development.
            nrel[family][name] = successor_text(o)
            names.add(name)
    return SnapshotIndex(
        snapshot_id=lst.snapshotId,
        source=lst.source,
        release_label=lst.release.label if lst.release else None,
        released_cds=frozenset(rel["cds"]),
        released_fms=frozenset(rel["fm"]),
        released_classes=frozenset(rel["class"]),
        released_tables=frozenset(rel["table"]),
        not_released_cds=nrel["cds"],
        not_released_fms=nrel["fm"],
        not_released_classes=nrel["class"],
        not_released_tables=nrel["table"],
        names=frozenset(names),
    )
