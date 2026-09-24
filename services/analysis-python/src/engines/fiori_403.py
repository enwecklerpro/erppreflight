"""Backward-compatibility module forwarding to fiori_auth_guard."""
from src.engines.fiori_auth_guard import Fiori403Engine, FioriAuthGuardEngine

__all__ = ["Fiori403Engine", "FioriAuthGuardEngine"]
