class AnalysisEngineException(Exception):
    """Base exception for analysis engine."""
    pass


class EngineNotFoundError(AnalysisEngineException):
    """Raised when requested engine is not registered."""
    pass


class SecurityViolationError(AnalysisEngineException):
    """Raised when an untrusted payload violates security policies (e.g. XXE)."""
    pass


class ArtifactProcessingError(AnalysisEngineException):
    """Raised when an artifact cannot be parsed or decoded."""
    pass


class EngineInputError(ArtifactProcessingError):
    """Raised by an engine when its input cannot be analysed (malformed payload, unexpected shape,
    or insufficient data). The runner converts it into a single UNKNOWN-confidence finding with
    ``rule_id`` and marks the analysis FAILED — never a positive verdict and never a raw traceback."""

    def __init__(
        self,
        rule_id: str,
        message: str,
        line_number: "int | None" = None,
        column_number: "int | None" = None,
        details: "dict | None" = None,
    ):
        super().__init__(message)
        self.rule_id = rule_id
        self.message = message
        self.line_number = line_number
        self.column_number = column_number
        self.details = details or {}
