# Working notes for Claude

- Reply in Korean, short and plain; the user is not a developer.
- Finish every task by listing direct links to the live pages that changed
  (https://assembly-dashboard.pages.dev/...), so the user can click to check.
- Merge finished work to main yourself (PR + merge); Cloudflare Pages deploys main.
- Never commit or print the Assembly API key; it is read from ASSEMBLY_API_KEY only.
- Do not show GitHub or repository details anywhere on the public site.
- Data is rebuilt by app/pipeline (fetch.py → build.py → check.py); generated files are not edited by hand.
