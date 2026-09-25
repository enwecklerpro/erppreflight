import base64
import binascii
from pydantic import BaseModel, Field, ConfigDict, PrivateAttr, model_validator
from typing import Dict, Any, Optional, List, Literal
from src.models.enums import EngineType, ArtifactType

RawContentEncoding = Literal["utf-8", "base64"]


def _decode_payload(raw_content: Optional[str], encoding: str) -> "tuple[Optional[str], Optional[bytes]]":
    """Returns (text, bytes) for an inline payload.

    utf-8: text is the payload, bytes is its utf-8 encoding.
    base64: bytes are the strictly validated decoded payload; text is the utf-8 decoding when the
    payload is valid UTF-8, otherwise None (binary artifact such as ZIP/XLSX).
    """
    if raw_content is None:
        return None, None
    if encoding != "base64":
        return raw_content, raw_content.encode("utf-8", errors="surrogatepass")
    try:
        data = base64.b64decode("".join(raw_content.split()), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"raw_content is not valid base64: {exc}") from exc
    try:
        text: Optional[str] = data.decode("utf-8")
    except UnicodeDecodeError:
        text = None
    return text, data


class ArtifactReference(BaseModel):
    artifact_id: Optional[str] = None
    file_name: str
    artifact_type: ArtifactType
    storage_key: Optional[str] = None
    raw_content: Optional[str] = None
    raw_content_encoding: RawContentEncoding = "utf-8"

    _raw_bytes: Optional[bytes] = PrivateAttr(default=None)

    @model_validator(mode="after")
    def _decode_raw_content(self) -> "ArtifactReference":
        text, data = _decode_payload(self.raw_content, self.raw_content_encoding)
        self._raw_bytes = data
        if self.raw_content_encoding == "base64":
            self.raw_content = text
        return self

    def get_raw_bytes(self) -> Optional[bytes]:
        """Exact artifact bytes (decoded from base64 when raw_content_encoding='base64')."""
        if self.raw_content_encoding != "base64":
            return None if self.raw_content is None else self.raw_content.encode("utf-8", errors="surrogatepass")
        return self._raw_bytes


class AnalysisOptions(BaseModel):
    deterministic_only: bool = True
    strict_validation: bool = True
    max_findings: int = Field(1000, ge=1)
    custom_params: Dict[str, Any] = Field(default_factory=dict)


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    job_id: str = Field(..., alias="job_id", description="UUID of the analysis job")
    tenant_id: str = Field(..., alias="tenant_id", description="UUID of the tenant organization")
    project_id: str = Field(..., alias="project_id", description="UUID of the workspace project")
    engine_type: EngineType = Field(..., alias="engine_type", description="Target engine to execute")
    target_release: str = Field("S4H_2023", alias="target_release", description="SAP target release (e.g. S4H_2023)")
    artifact_s3_key: Optional[str] = Field(None, alias="artifact_s3_key", description="S3 storage key for artifact")
    artifact_type: ArtifactType = Field(ArtifactType.JSON, alias="artifact_type")
    configuration: Dict[str, Any] = Field(default_factory=dict)
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)

    # Inline payload. The NestJS API downloads the artifact from storage and sends it here;
    # this service never fetches from S3 itself.
    raw_content: Optional[str] = Field(None, description="Inline payload content")
    raw_content_encoding: RawContentEncoding = Field(
        "utf-8",
        description="Encoding of raw_content: 'utf-8' text or 'base64' (binary artifacts such as ZIP/XLSX)",
    )
    artifacts: List[ArtifactReference] = Field(default_factory=list)

    _raw_bytes: Optional[bytes] = PrivateAttr(default=None)

    @model_validator(mode="after")
    def _decode_raw_content(self) -> "AnalysisRequest":
        # For base64 payloads text engines see the utf-8 decoded text (None when binary);
        # byte-oriented engines read get_raw_bytes().
        text, data = _decode_payload(self.raw_content, self.raw_content_encoding)
        self._raw_bytes = data
        if self.raw_content_encoding == "base64":
            self.raw_content = text
        return self

    def get_raw_bytes(self) -> Optional[bytes]:
        """Exact inline payload bytes (decoded from base64 when raw_content_encoding='base64')."""
        if self.raw_content_encoding != "base64":
            return None if self.raw_content is None else self.raw_content.encode("utf-8", errors="surrogatepass")
        return self._raw_bytes
