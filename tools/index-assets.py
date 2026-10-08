"""Update the packaged word/audio index without rewriting application source."""
from pathlib import Path
import json

web = Path(__file__).resolve().parents[1] / 'app/src/main/assets/web'
entries = [
    {'name': path.name, 'path': path.relative_to(web).as_posix(),
     'url': '/assets/web/' + path.relative_to(web).as_posix()}
    for path in sorted((web / 'words').rglob('*')) if path.is_file()
]
(web / 'manifest.json').write_text(json.dumps(entries, ensure_ascii=False), encoding='utf-8')
print(f'Indexed {len(entries)} files')
