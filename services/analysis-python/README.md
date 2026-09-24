# ERP Preflight Analysis Engine (Python FastAPI)

The computational core microservice of ERP Preflight, providing deterministic parsing, domain rule evaluations, and statistical analysis across SAP customer artifacts.

## Quick Start
```bash
# Run tests
py -m pytest services/analysis-python/tests -v

# Run service
py -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```
