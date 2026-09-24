from src.core.registry import EngineRegistry
from src.models.enums import EngineType
import src.engines  # ensure all engines registered


def test_registry_contains_all_19_engines():
    count = EngineRegistry.count()
    assert count >= 19, f"Expected at least 19 engines, found {count}"


def test_each_engine_type_is_accessible():
    for engine_type in EngineType:
        engine = EngineRegistry.get(engine_type)
        assert engine is not None
        assert engine.engine_type == engine_type
        metadata = engine.get_metadata()
        assert "name" in metadata
        assert "description" in metadata
        assert "supported_artifact_types" in metadata
