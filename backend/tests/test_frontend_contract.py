"""Detect drift between the checked-in frontend OpenAPI contract and FastAPI."""

import json
from pathlib import Path

from backend.app.main import app


def test_checked_in_openapi_contains_every_fastapi_api_route():
    contract_path = Path(__file__).parents[2] / "voltiq" / "contracts" / "backend-openapi.json"
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    expected = set(contract["paths"])
    actual = {route.path for route in app.routes if route.path.startswith("/api/v1")}
    assert actual <= expected, f"FastAPI routes missing from frontend contract: {sorted(actual - expected)}"


def test_contract_and_api_share_envelope_version_and_time_basis():
    health = next(route for route in app.routes if route.path == "/api/v1/health")
    assert health.path in json.loads(
        (Path(__file__).parents[2] / "voltiq" / "contracts" / "backend-openapi.json").read_text(encoding="utf-8")
    )["paths"]
    response = health.endpoint()
    assert response["meta"] == {
        "schema_version": "2.0",
        "time_basis": "source_local_naive",
    }
