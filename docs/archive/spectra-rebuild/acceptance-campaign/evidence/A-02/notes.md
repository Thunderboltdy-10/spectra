# A-02 Account, role, and resolution verification

Date: 2026-07-24

## Identity mapping (verified via `/api/spectra/administration?action=identity`)

| Chrome page | Spectra email | Display | Role | Platform operator | Plan label |
|-------------|---------------|---------|------|-------------------|------------|
| Page 2 | `[school-account-email]` | P MD | school_admin | true | **Tab P** |
| Page 1 | `pablo.martinez.dovale@gmail.com` | Pablo MD | school_admin | true | **Tab C** |

## Findings
- Both accounts currently have Super Admin nav (`platformOperator: true`) and school_admin membership. Plan assumed Tab C lacked Super Admin; live state differs — treat as verified ground truth, still use Tab C primarily for two-user collaboration and ManageBac absence checks.
- Both pages at `/workspace?home=1`.
- Resize to 1920x1080 initially blocked by maximized window (`Browser.setContentsSize`); will normalize before visual tasks.

## Grade
**Pass** → needs Excellent: confirm ManageBac presence on Tab P only, and normalize viewport to 1920x1080 before visual work. Role leakage concern (Tab C is also platformOperator) deferred to H-15 (operator eligibility is env-driven via `SUPER_ADMIN_EMAILS`, not a product bug if both emails are listed).

## Follow-up before Excellent
1. Tab P `/managebac` connected; Tab C disconnected/denied.
2. Successful 1920x1080 resize on both pages.
