# Price search workspace

## Direction

A procurement workspace with a clear search hierarchy, readable prices, and source-specific results. The functional interface takes precedence over marketing page effects. The differentiation comes from the Portal header, pale-blue offer frames, dark-blue prices, red actions, and the four-source comparison workflow. Frontend-design feasibility assessment: impact 4, context fit 5, feasibility 5, performance 5, consistency risk 4; DFII 15.

## Actual kit components

Source: [user-provided Portal Postavshikov kit copy](https://www.figma.com/board/YmpRGshnGPUqcyxagZGWcu/Portal-Postavshikov--catalog---Copy-?node-id=0-1).

- Header `1:3781` and exported logo `1:3828`: white 80px header with the original SVG and blue navigation text.
- Search field `1:54850`, dropdown `1:59384`, red button `1:59467`: 48px controls, square corners, original pale-blue/white field treatments.
- Auction card family `1:4138`: pale-blue shell and white content panels adapted to existing product offers without fictitious auction functionality.
- Popup family `1:2112`: flat white dialog, blue close control, separated footer and red primary action, with keyboard focus management and responsive sizing.

Colors: `#264B82`, `#DB2B21`, `#E7EEF7`, `#D4DBE6`, `#1A1A1A`. Open Sans is locally hosted; the font license is retained in `frontend/public/fonts/OFL-OpenSans.txt`. Controls follow the kit's 48px height, and spacing uses a 4px rhythm. Motion is limited to interaction feedback; reduced-motion preferences are supported.

## Behavior and verification

Search preserves the existing `/api/suggest`, `/api/correct` and four `/api/search/{source}` contracts. Query and region are sent to each source; price bounds remain URL parameters used for client filtering. No frontend initial maximum contract price calculation is introduced. Backend algorithms and dependencies are unchanged. The lockfile was repaired to make the existing dependency declarations installable; direct dependency versions were preserved.

Build and ESLint pass. Browser review uses fabricated fixtures: autocomplete keyboard selection, validation, all four sources, price filtering, dialog focus/trapping/restoration, source links, navigation, correction, isolated source failure and empty results. Responsive checks cover 1440, 1024, 820, 768, 390 and 320px without horizontal overflow. Live source accuracy and production backend integration were not verified.

## Requested design skills

Unslop is created by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its spacing, typography, copy and restrained-detail passes were applied alongside frontend-design and tasteskill. The optional taste gate reported 28 findings: five focus findings were corrected; the remaining marketing geometry/effect rules conflict with the requested functional kit. A passing taste gate is not claimed.

The inherited dependency audit reports 14 findings (1 low, 5 moderate, 8 high, 0 critical). Broad dependency remediation is outside this interface change.
