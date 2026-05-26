import os

from flask import Flask, send_from_directory
from flask_cors import CORS

from .config import Config
from .routes import api_bp

_FRONTEND_DIST = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config())

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": app.config["CORS_ORIGINS"],
            }
        },
    )

    app.register_blueprint(api_bp, url_prefix="/api")

    if os.path.isdir(_FRONTEND_DIST):
        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def serve_frontend(path: str):
            target = os.path.join(_FRONTEND_DIST, path) if path else None
            if target and os.path.isfile(target):
                return send_from_directory(_FRONTEND_DIST, path)
            return send_from_directory(_FRONTEND_DIST, "index.html")

    return app
