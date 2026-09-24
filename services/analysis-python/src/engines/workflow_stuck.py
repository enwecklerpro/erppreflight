"""Backward-compatibility module forwarding to workflow_deadlock."""
from src.engines.workflow_deadlock import WorkflowStuckEngine, WorkflowDeadlockEngine

__all__ = ["WorkflowStuckEngine", "WorkflowDeadlockEngine"]
