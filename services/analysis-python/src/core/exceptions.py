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
