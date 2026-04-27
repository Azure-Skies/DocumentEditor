import os
import tempfile
import unittest

db_fd, db_path = tempfile.mkstemp(suffix=".db")
os.close(db_fd)
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

from fastapi.testclient import TestClient

import app.__main__ as api


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        api.Base.metadata.drop_all(bind=api.engine)

    def test_version_lifecycle(self):
        with TestClient(api.app) as client:
            documents = client.get("/documents")
            self.assertEqual(documents.status_code, 200)
            self.assertEqual(len(documents.json()), 2)

            first_version = client.get("/document/1").json()
            self.assertEqual(first_version["version"], 1)

            new_version = client.post(
                "/save/1",
                json={"title": "Patent 1", "content": "<p>new draft</p>"},
            )
            self.assertEqual(new_version.status_code, 200)
            self.assertEqual(new_version.json()["version"], 2)

            update = client.put(
                f"/document/1/version/{first_version['id']}",
                json={"title": "Patent 1", "content": "<p>updated old draft</p>"},
            )
            self.assertEqual(update.status_code, 200)
            self.assertEqual(update.json()["content"], "<p>updated old draft</p>")

            latest = client.get("/document/1").json()
            self.assertEqual(latest["version"], 2)
            self.assertEqual(latest["content"], "<p>new draft</p>")

    def test_ai_answer_persists_messages_without_editing_document(self):
        def answer_response(request):
            return api.schemas.AIActionResponse(
                action="answer",
                reply="Claim 1 is broad.",
                content=request.content,
            )

        original_generate_ai_response = api.generate_ai_response
        api.generate_ai_response = answer_response
        try:
            with TestClient(api.app) as client:
                version = client.get("/document/1").json()
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
        finally:
            api.generate_ai_response = original_generate_ai_response

    def test_ai_edit_updates_selected_version(self):
        def edit_response(_request):
            return api.schemas.AIActionResponse(
                action="edit",
                reply="Updated claim 1.",
                content="<p>edited by ai</p>",
            )

        original_generate_ai_response = api.generate_ai_response
        api.generate_ai_response = edit_response
        try:
            with TestClient(api.app) as client:
                version = client.get("/document/1").json()
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

                saved_version = client.get(
                    f"/document/1/version/{version['id']}"
                ).json()
                self.assertEqual(saved_version["content"], "<p>edited by ai</p>")
        finally:
            api.generate_ai_response = original_generate_ai_response

    def test_rejects_too_many_context_files(self):
        with TestClient(api.app) as client:
            version = client.get("/document/1").json()
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
