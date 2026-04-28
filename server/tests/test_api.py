from contextlib import contextmanager
import os
import tempfile
import unittest

db_fd, db_path = tempfile.mkstemp(suffix=".db")
os.close(db_fd)
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

from fastapi.testclient import TestClient

import app.__main__ as api


@contextmanager
def mocked_ai_response(action="answer", reply="AI reply", content=None):
    original_generate_ai_response = api.generate_ai_response

    def generate_ai_response(request):
        return api.schemas.AIActionResponse(
            action=action,
            reply=reply,
            content=request.content if content is None else content,
        )

    api.generate_ai_response = generate_ai_response
    try:
        yield
    finally:
        api.generate_ai_response = original_generate_ai_response


def latest_version(client, document_id=1):
    response = client.get(f"/document/{document_id}")
    response.raise_for_status()
    return response.json()


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        api.Base.metadata.drop_all(bind=api.engine)

    def test_get_documents(self):
        with TestClient(api.app) as client:
            response = client.get("/documents")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json(),
                [{"id": 1, "title": "Patent 1"}, {"id": 2, "title": "Patent 2"}],
            )

    def test_get_document_returns_latest_version(self):
        with TestClient(api.app) as client:
            client.post(
                "/save/1",
                json={"title": "Patent 1", "content": "<p>new draft</p>"},
            )

            response = client.get("/document/1")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["version"], 2)
            self.assertEqual(response.json()["content"], "<p>new draft</p>")

    def test_get_document_versions(self):
        with TestClient(api.app) as client:
            client.post(
                "/save/1",
                json={"title": "Patent 1", "content": "<p>new draft</p>"},
            )

            response = client.get("/document/1/versions")

            self.assertEqual(response.status_code, 200)
            self.assertEqual([version["version"] for version in response.json()], [2, 1])

    def test_get_document_version(self):
        with TestClient(api.app) as client:
            version = latest_version(client)

            response = client.get(f"/document/1/version/{version['id']}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["id"], version["id"])
            self.assertEqual(response.json()["version"], 1)

    def test_save_creates_new_version(self):
        with TestClient(api.app) as client:
            response = client.post(
                "/save/1",
                json={"title": "Patent 1", "content": "<p>new draft</p>"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["version"], 2)
            self.assertEqual(response.json()["content"], "<p>new draft</p>")

    def test_update_version_updates_selected_version(self):
        with TestClient(api.app) as client:
            version = latest_version(client)

            response = client.put(
                f"/document/1/version/{version['id']}",
                json={"title": "Patent 1", "content": "<p>updated old draft</p>"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["content"], "<p>updated old draft</p>")
            self.assertEqual(latest_version(client)["content"], "<p>updated old draft</p>")

    def test_ai_write_route_returns_generated_content(self):
        with mocked_ai_response(content="<p>suggested draft</p>"):
            with TestClient(api.app) as client:
                response = client.post(
                    "/ai/write",
                    json={
                        "instruction": "Rewrite claim 1",
                        "title": "Patent 1",
                        "content": "<p>original</p>",
                    },
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json(),
                    {"reply": "AI reply", "content": "<p>suggested draft</p>"},
                )

    def test_ai_write_answer_persists_messages_without_editing_document(self):
        with mocked_ai_response(action="answer", reply="Claim 1 is broad."):
            with TestClient(api.app) as client:
                version = latest_version(client)
                response = client.post(
                    f"/document/1/version/{version['id']}/ai/write",
                    json={
                        "instruction": "What does claim 1 cover?",
                        "title": version["title"],
                        "content": version["content"],
                        "history": [],
                        "context_files": [
                            {
                                "name": "prior-art.txt",
                                "content": "A short prior art note.",
                            }
                        ],
                    },
                )

                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()["did_edit"])
                self.assertEqual(
                    response.json()["document"]["content"], version["content"]
                )
                self.assertEqual(len(response.json()["messages"]), 2)
                self.assertEqual(
                    response.json()["messages"][0]["context_files"][0]["name"],
                    "prior-art.txt",
                )

    def test_ai_write_edit_updates_selected_version(self):
        with mocked_ai_response(
            action="edit", reply="Updated claim 1.", content="<p>edited by ai</p>"
        ):
            with TestClient(api.app) as client:
                version = latest_version(client)
                response = client.post(
                    f"/document/1/version/{version['id']}/ai/write",
                    json={
                        "instruction": "Make claim 1 clearer",
                        "title": version["title"],
                        "content": version["content"],
                    },
                )

                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["did_edit"])
                self.assertEqual(
                    response.json()["document"]["content"], "<p>edited by ai</p>"
                )
                saved_version = client.get(f"/document/1/version/{version['id']}").json()
                self.assertEqual(saved_version["content"], "<p>edited by ai</p>")

    def test_get_ai_messages(self):
        with mocked_ai_response(reply="Stored response"):
            with TestClient(api.app) as client:
                version = latest_version(client)
                client.post(
                    f"/document/1/version/{version['id']}/ai/write",
                    json={
                        "instruction": "Summarize",
                        "title": version["title"],
                        "content": version["content"],
                    },
                )

                response = client.get(
                    f"/document/1/version/{version['id']}/ai/messages"
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    [message["role"] for message in response.json()],
                    ["user", "assistant"],
                )
                self.assertEqual(response.json()[1]["content"], "Stored response")

    def test_delete_ai_messages(self):
        with mocked_ai_response():
            with TestClient(api.app) as client:
                version = latest_version(client)
                client.post(
                    f"/document/1/version/{version['id']}/ai/write",
                    json={
                        "instruction": "Summarize",
                        "title": version["title"],
                        "content": version["content"],
                    },
                )

                response = client.delete(
                    f"/document/1/version/{version['id']}/ai/messages"
                )
                messages = client.get(
                    f"/document/1/version/{version['id']}/ai/messages"
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), [])
                self.assertEqual(messages.json(), [])

    def test_rejects_too_many_context_files(self):
        with TestClient(api.app) as client:
            version = latest_version(client)
            response = client.post(
                f"/document/1/version/{version['id']}/ai/write",
                json={
                    "instruction": "Use these files",
                    "title": version["title"],
                    "content": version["content"],
                    "context_files": [
                        {"name": f"file-{index}.txt", "content": "context"}
                        for index in range(api.schemas.MAX_CONTEXT_FILES + 1)
                    ],
                },
            )

            self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
