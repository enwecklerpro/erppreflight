from typing import Dict, Type, List
from src.models.enums import EngineType
from src.core.base_engine import BaseEngine
from src.core.exceptions import EngineNotFoundError


class EngineRegistry:
    """Thread-safe registry containing all 18 SAP engines + MFS BlackBox."""

    _engines: Dict[EngineType, BaseEngine] = {}

    @classmethod
    def register(cls, engine_cls: Type[BaseEngine], replace: bool = False) -> Type[BaseEngine]:
        """Registers one engine class per EngineType.

        Deterministic: re-registering the same class is idempotent; registering a different
        class for an already-registered EngineType raises unless replace=True is explicit,
        so module import order can never silently shadow an engine.
        """
        engine_type = getattr(engine_cls, "engine_type", None)
        existing = cls._engines.get(engine_type) if engine_type is not None else None
        if existing is not None and not replace:
            if type(existing) is engine_cls:
                return engine_cls
            raise ValueError(
                f"Engine type '{engine_type}' already registered by "
                f"{type(existing).__module__}.{type(existing).__name__}; refusing to shadow it with "
                f"{engine_cls.__module__}.{engine_cls.__name__}."
            )
        instance = engine_cls()
        cls._engines[instance.engine_type] = instance
        return engine_cls

    @classmethod
    def get(cls, engine_type: EngineType) -> BaseEngine:
        if engine_type not in cls._engines:
            raise EngineNotFoundError(f"Engine '{engine_type}' is not registered.")
        return cls._engines[engine_type]

    @classmethod
    def list_all(cls) -> List[dict]:
        return [engine.get_metadata() for engine in cls._engines.values()]

    @classmethod
    def is_registered(cls, engine_type: EngineType) -> bool:
        return engine_type in cls._engines

    @classmethod
    def count(cls) -> int:
        return len(cls._engines)


def register_engine(cls: Type[BaseEngine]) -> Type[BaseEngine]:
    """Decorator for registering an engine class."""
    return EngineRegistry.register(cls)
