# Security Policy

## Supported versions

Security fixes target the current `main` (production) and `develop` (development)
branches. The published editor is built from `main`; builds from `develop` are
for testing ongoing changes. Update older downloaded copies by rebuilding from
the current `main` source or downloading the latest deployed editor. Older
commits, releases, and modified forks do not receive separate security fixes.

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting form](https://github.com/rchalasani93/EliteReduxSavEditor/security/advisories/new)
to report suspected vulnerabilities to the maintainers. It is also available
under **Security → Advisories → Report a vulnerability** in this repository.
Keep exploit details private until a fix or coordinated disclosure is available.

Include the following when possible:

- The affected commit or editor version and where it was downloaded.
- Browser, operating system, and steps to reproduce the problem.
- Expected behavior, actual behavior, and potential security impact.
- A minimal proof of concept or synthetic save/catalog fixture. Remove personal
  data and secrets; a full real save or ROM is not needed for an initial report.

Reports are reviewed on a best-effort basis. This project has no guaranteed
response or remediation time. Follow-up questions, investigation updates, and
disclosure coordination take place in the private report.

Ordinary bugs and format compatibility questions can be reported through
[GitHub issues](https://github.com/rchalasani93/EliteReduxSavEditor/issues).
If an issue may expose data, execute unintended code, or compromise the published
editor or its build process, use private reporting first.

## Security scope

Relevant reports include script execution through imported saves or catalogs,
unintended disclosure of save data, malformed inputs that bypass save/export
integrity checks, and vulnerabilities in repository workflows or published
artifacts. Issues in an emulator, ROM, or external data source should also be
reported to the project responsible for that component.

The editor processes saves locally in browser memory. Keep an untouched backup
before editing, and download the editor and data only from sources you trust.
