import os

from flask import Flask, send_from_directory
from flask_cors import CORS


def create_app(test_config=None):
    """Create and configure an instance of the Flask application."""
    # Get the path to the static build folder
    static_folder = os.path.join(os.path.dirname(__file__), 'static', 'build')
    
    app = Flask(__name__, static_folder=static_folder, static_url_path='')
    CORS(app)

    # ===== Load base configuration
    database_url = os.environ.get("DATABASE_URL", "sqlite:///:memory:")
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    secret_key = os.environ.get("SECRET_KEY", "dev")
    app.config.from_mapping(
        SECRET_KEY=secret_key,
        SQLALCHEMY_DATABASE_URI=database_url,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
    )
    if test_config is not None:
        app.config.update(test_config)

    # ===== Initialize Database
    from catanatron.web.models import db

    with app.app_context():
        db.init_app(app)
        db.create_all()

    # ===== Initialize Routes
    from . import api

    app.register_blueprint(api.bp)

    # ===== Serve React App
    @app.route('/')
    def serve():
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/<path:path>')
    def serve_static(path):
        if os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, 'index.html')

    return app
