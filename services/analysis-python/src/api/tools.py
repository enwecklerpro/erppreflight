"""Public free-tool helpers (called by apps/api only; the web app never calls this service)."""

from typing import Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from src.tools.xml_field_check import MAX_PATH_CHARS, MAX_XML_BYTES, PathSyntaxError, check_xml_field

router = APIRouter(prefix="/api/v1/tools", tags=["Free tools"])


class XmlFieldCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Characters, not bytes: the byte limit is enforced after UTF-8 encoding by the checker.
    xml: str = Field(min_length=1, max_length=MAX_XML_BYTES)
    path: str = Field(min_length=1, max_length=MAX_PATH_CHARS)
    namespaces: Optional[Dict[str, str]] = Field(default=None, max_length=20)


@router.post("/xml-field-check")
def xml_field_check(req: XmlFieldCheckRequest) -> dict:
    """Deterministic, in-memory XML field check (defusedxml; no storage, no logging of content)."""
    try:
        return check_xml_field(req.xml, req.path, req.namespaces)
    except PathSyntaxError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
