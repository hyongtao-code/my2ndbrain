# Contributing

Thanks for your interest in MySecondBrain.

## Quick start

1. Fork and clone.
2. Backend: `cd backend && pip install -r requirements.txt && PYTHONPATH=. python3 scripts/init_db.py && PYTHONPATH=. uvicorn app.main:app --host 127.0.0.1 --port 8000`
3. Frontend: `cd frontend && npm install && npm run dev`
4. Open <http://127.0.0.1:5173/>.

## Pull requests

- Keep PRs focused; one feature / one fix per PR.
- Add or update tests for behaviour changes.
- Follow the existing code style (PEP 8 for Python, project ESLint config for TS).
- Update `README.md` if you change user-facing behaviour.

## Issues

- Use the GitHub issue templates.
- Include reproduction steps for bugs.
- For security issues, see `SECURITY.md` instead of filing a public issue.

## License

By contributing you agree your contributions are licensed under the
project's Apache License 2.0.