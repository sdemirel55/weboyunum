from pathlib import Path
import base64

assets = Path(__file__).parent / "app" / "src" / "main" / "assets"
out_dir = Path(__file__).parent / "app" / "src" / "main" / "res" / "drawable-nodpi"
out_dir.mkdir(parents=True, exist_ok=True)
encoded = "".join((assets / f"icon_chunk_{index}.txt").read_text().strip() for index in range(1, 5))
(out_dir / "sfd_logo.png").write_bytes(base64.b64decode(encoded))
