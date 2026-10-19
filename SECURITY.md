# Security policy

## What is in scope

ETERNIX is a static browser game. It has no server code, no accounts, no payments, and no environment variables. Game
code makes no network requests. The only data it stores is the save file in the browser's local storage, described in
the README.

Reports about the following are in scope:

- Code in this repository that runs in a visitor's browser and could harm that visitor (for example, script injection
  through saved data).
- The build or deployment workflow, if it could leak a secret or run untrusted code.
- A secret, token, or credential that was committed to the repository.

## How to report

Please do not open a public issue for a security problem.

Use GitHub's **private vulnerability reporting** for this repository, if the repository owner has turned it on
(**Security > Report a vulnerability**). If it is not turned on, open a public issue that says only that you have a
security report and asks for a private contact. Do not include exploit details in the public issue.

## What to expect

ETERNIX is maintained on a best-effort basis. There is no guaranteed response time. A report will be read, and the
maintainers will reply when they can. A confirmed problem will be fixed in the repository, and the fix will be described
in the release notes.

## Secrets

Never commit real credentials, API keys, or tokens. If one is committed by mistake, revoke it first, then remove it from
the repository. Rewriting history is a separate decision for the maintainers.
