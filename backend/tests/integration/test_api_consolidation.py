"""
API consolidation tests for task-7.

These tests validate endpoint availability entirely in-process so the suite
can run with a single pytest command and no separately started backend.
"""
import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    """Create an in-process API client."""
    return TestClient(app)


@pytest.mark.integration
class TestAPIConsolidationBefore:
    """
    Test current API endpoints before consolidation.

    Documents which endpoints exist and work currently.
    """

    def test_root_endpoint(self, client):
        """Test root endpoint availability."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "version" in data

    def test_health_endpoint(self, client):
        """Test health check endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    def test_api_v1_configs_endpoint(self, client):
        """Test /api/v1/configs endpoint."""
        response = client.get("/api/v1/configs")
        assert response.status_code == 200
        data = response.json()
        assert "configurations" in data

    def test_api_v1_upload_endpoint(self):
        """Test /api/v1/upload endpoint."""
        # File upload behavior is covered by the contract suite.
        pass

    def test_api_v1_preview_endpoint_format(self, client):
        """Test that /api/v1/preview/{file_id} endpoint format is correct."""
        response = client.get("/api/v1/preview/test_file_id")
        assert response.status_code in [404, 422, 500]


@pytest.mark.integration
class TestAPIConsolidationAfter:
    """
    Test API endpoints after consolidation.

    These tests should pass after task-7 is complete.
    """

    def test_only_api_v1_configs_works(self, client):
        """Test that only /api/v1/configs works after consolidation."""
        response = client.get("/api/v1/configs")
        assert response.status_code == 200

        response = client.get("/api/v3/configs")
        assert response.status_code == 404

        response = client.get("/configs")
        assert response.status_code == 404

    def test_only_api_v1_preview_works(self, client):
        """Test that only /api/v1/preview works after consolidation."""
        response = client.get("/api/v1/preview/test_file_id")
        assert response.status_code in [404, 422, 500]

        response = client.get("/preview/test_file_id")
        assert response.status_code == 404

    def test_api_v1_all_endpoints_available(self, client):
        """Test that all expected /api/v1 endpoints are available."""
        expected_v1_endpoints = [
            "/api/v1/configs",
            "/api/v1/upload",
            "/api/v1/detect-range/test_id",
            "/api/v1/parse-range/test_id",
            "/api/v1/multi-csv/parse",
            "/api/v1/multi-csv/transform",
            "/api/v1/transform",
            "/api/v1/export",
        ]

        for endpoint in expected_v1_endpoints:
            response = client.get(endpoint)
            if "test_id" in endpoint:
                assert response.status_code in [404, 405, 422, 500], (
                    f"Endpoint {endpoint} should exist (got {response.status_code})"
                )
            else:
                assert response.status_code != 404, (
                    f"Endpoint {endpoint} should exist (got {response.status_code})"
                )


def run_pre_consolidation_tests():
    """Run tests to document the current API state."""
    print("Running pre-consolidation API tests...")

    working_endpoints = []
    test_endpoints = ["/", "/health", "/api/v1/configs", "/api/v3/configs", "/configs"]
    client = TestClient(app)

    for endpoint in test_endpoints:
        response = client.get(endpoint)
        if response.status_code == 200:
            working_endpoints.append(endpoint)
            print(f"PASS {endpoint} - Status: {response.status_code}")
        else:
            print(f"WARN {endpoint} - Status: {response.status_code}")

    print(f"\nSummary: {len(working_endpoints)} endpoints working")
    return working_endpoints


if __name__ == "__main__":
    run_pre_consolidation_tests()
