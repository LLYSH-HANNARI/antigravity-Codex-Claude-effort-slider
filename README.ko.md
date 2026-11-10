# Antigravity Codex & Claude 스타일 추론 단계 슬라이더 (`antigravity-codex&Claude-effort-slider`)

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.ru.md">Русский</a> |
  <a href="./README.ja.md">日本語</a> |
  <b>한국어</b> |
  <a href="./README.fr.md">Français</a>
</p>

[![Version](https://img.shields.io/badge/version-1.2.6-blue.svg)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-8%20passed-success.svg)](./test/client.test.mjs)
[![Platform](https://img.shields.io/badge/platform-Antigravity%20Desktop%20%7C%20Antigravity%20IDE-purple.svg)](https://antigravity.google/)
[![Demo](https://img.shields.io/badge/demo-online%20preview-orange.svg)](https://llysh-hannari.github.io/antigravity-Codex-Claude-effort-slider/)

![Preview](assets/Gemini.png)

> [!IMPORTANT]
> ### 면책 조항 (Disclaimer)
> 1. **Gemini 캐릭터 일러스트 출처 명시**: 본 프로젝트에 사용된 Gemini 의인화 이미지는 개발자 개인의 팬 활동 및 취향에 따른 창작물이며, **Google 공식과는 아무런 제휴나 승인 관계가 없습니다**. 캐릭터 원안 및 디자인 저작권은 Bilibili 크리에이터인 **ZipZipPipe** 님에게 있습니다.
> 2. **비공식 제3자 소프트웨어**: 본 프로젝트는 개인 및 커뮤니티 오픈소스로 제작된 확장 플러그인이며, **Google / Google Antigravity**, **Anthropic**, **OpenAI** 및 관련 기업과 공식적인 제휴나 상업적 종속 관계가 없습니다.
> 3. **디자인 출처 및 오마주 선언**: OpenAI Codex 스타일의 물리 슬라이더 및 Anthropic Claude Code 스타일의 캡슐 도트 매트릭스 애니메이션은 공개 제품의 인터랙션 디자인에서 영감을 받았습니다. 관련 상표 및 브랜드 권리는 각 소유권자에게 귀속됩니다.
> 4. **독자 소스코드 개발**: 본 저장소의 모든 클라이언트 런타임 및 물리 애니메이션 엔진은 작성자가 독자적으로 설계하고 개발하였으며, 상기 기업의 비공개 상용 코드를 포함하지 않습니다.
> 5. **사용자 책임**: 본 코드는 프론트엔드 엔지니어링 교류 및 개인 연구 목적으로 제공됩니다. 패치 적용에 따른 환경 변화 및 결과는 사용자 본인의 책임입니다.
> 6. **광과민성 발작 경고 (Photosensitive Seizure Warning)**: 본 확장 기능에는 파티클 물리 효과 및 성운 확산 애니메이션이 포함되어 있어, 빠른 드래그 조작 시 깜빡임이 발생할 수 있습니다. 민감한 사용자는 주의하시기 바라며 어지러움 발생 시 즉시 사용을 중단하십시오.

> 저는 인터넷에서 구글을 비방한 적이 없으며, Logan을 광대라고 부르지도 않았고, Gemini의 우스꽝스러운 용 짤을 만든 적도 없습니다. 제가 말했던 "북미 두포", "빠르지만 엉망", "멀티모달만 쓸만함" 같은 표현들은 모두 미국 Mira사의 오픈 가중치 모델 Inkling을 가리킨 것이었습니다. 저는 3.1 Pro의 가장 어두운 시절에도 꿋꿋이 고양이를 쓰다듬던 10년 차 골수 구글 팬입니다. 깊은 고민 끝에 Gemini야말로 미국 AI의 미래임을 깨달았고, Gemini 팬클럽에 가입하기로 했습니다. OpenAI와 Anthropic의 폐쇄형 모델에도 행운을 빕니다!

## [온라인 대화형 데모 체험 (Live Demo)](https://llysh-hannari.github.io/antigravity-Codex-Claude-effort-slider/)

| 모델 | 라이트 모드 | 다크 모드 |
| :--- | :--- | :--- |
| Gemini High | ![라이트High](assets/GeminiLightHigh.png) | ![다크High](assets/GeminiDarkHigh.png) |
| Gemini Medium | ![라이트Medium](assets/GeminiLightMedium.png) | ![다크Medium](assets/GeminiDarkMedium.png) |
| Gemini Low | ![라이트Low](assets/GeminiLightLow.png) | ![다크Low](assets/GeminiDarkLow.png) |
| Claude High | ![라이트High](assets/ClaudeLightHigh.png) | ![다크High](assets/ClaudeDarkHigh.png) |
| Claude Medium | ![라이트Medium](assets/ClaudeLightMedium.png) | ![다크Medium](assets/ClaudeDarkMedium.png) |
| Claude Low | ![라이트Low](assets/ClaudeLightLow.png) | ![다크Low](assets/ClaudeDarkLow.png) |

---
> ### 보안 및 운영 환경 위험 경고
> 본 프로젝트는 비공식 서드파티 로컬 패치 도구이며, **Google / Antigravity 공식 제품이 아닙니다**.
> 1. **공식 저장소 확인**: 반드시 공식 GitHub 저장소([LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider](https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider))에서만 코드를 내려받으십시오. 출처가 불분명한 `.cmd` 또는 `.ps1` 스크립트를 실행하지 마십시오.
> 2. **환경 백업 필수**: 프로덕션이나 중요 환경에서 직접 패치하지 마시고, 실행 전 `resources/app.asar` 백업 파일이 있는지 반드시 확인하십시오.
---
## 빠른 설치 및 사용 방법

### 방법 1: 더블클릭 원클릭 영구 설치 (권장)
프로젝트 루트 경로의 **[`install.cmd`](./install.cmd)**를 더블클릭(또는 터미널에서 `npm run install-patch` 실행):
1. **영구 부팅 패치**: Antigravity 데스크톱의 `resources/app.asar`를 자동 백업하고 패치 적용(`electron.webFrame.executeJavaScript`로 메인 렌더러에 주입하고 PE Integrity SHA-256 검사값을 자동 재계산)하며, Antigravity IDE(`resources/app/out/jetskiAgent/main.js`)에도 반영됩니다.
2. **실행 중인 창에 핫 리로드 즉각 반영**: Antigravity가 이미 켜져 있는 경우 로컬 CDP 포트를 통해 실행 중인 모든 창에 즉시 주입되므로 재부팅할 필요가 없습니다.

> 원본 공식 파일로 복원하려면 **[`uninstall.cmd`](./uninstall.cmd)**를 더블클릭하십시오.

### 방법 2: 런타임 CDP 핫 인젝션만 사용 (파일 수정 없음)
디스크 파일을 건드리지 않고 실행 중에만 테스트하려면:
```bash
npm run inject
```
인젝션 해제:
```bash
npm run eject
```

---

## 핵심 기능 매트릭스

### 1. 손을 떼지 않고 즉각 반응하는 무단 드래그 전환
- **`pointermove` 단계 관통 제어**: 슬라이더를 드래그하는 도중 경계를 넘어서는 즉시 Antigravity 내부 세션 상태 API `setModelConfigByLabelForConversation`를 호출합니다. 마우스 버튼을 놓을 필요 없이 `Low ↔ Medium ↔ High`를 유연하게 오갑니다.
- **1/3 너비 히스테리시스 래칫**: 단계 경계면에 1/3 너비 완충 영역을 설정하여 약 70ms의 부드러운 스냅감을 구현하고 떨림을 방지합니다.
- **메뉴가 닫히지 않고 상시 유지**: 외부 Radix Popover / Base UI의 `setIsOpen(false)` 자동 닫힘을 완전히 차단합니다.

### 2. 모델 패널과의 깊은 연동
- **전용 하단 슬라이더**: 모델 선택 팝업(`[data-testid="model-selector-panel"]`)의 최하단에 전용 추론 슬라이더(`.ces-ag-section`)를 자연스럽게 결합하여 현재 단계(`Low` / `Medium` / `High`)를 보여줍니다.
- **팝업 닫힘 없는 모델 변경**: 목록에서 다른 모델(`Gemini 4 Argon` ↔ `Claude Sonnet 5.5`)을 클릭해도 메뉴가 닫히지 않고 즉시 해당 모델의 추론 슬라이더로 재배치됩니다.
- **단일 단계 모델 비활성화**: 고정 단계를 가진 모델(`GPT-OSS 120B (Medium)`) 선택 시 자동으로 비활성화 잠금 상태가 됩니다.

### 3. View Usage 0.3초(300ms) 호버 오작동 방지
- **오동작 방지 딜레이**: IDE Webview 프록시에서 `main.js`의 `View Usage` 컴포넌트에 `{delay: 300}` 속성을 주입하여 서브 메뉴 오픈 시간을 100ms에서 300ms로 늘립니다.
- **W3C 표준 다차원 퇴장 감지**: 타깃 레벨 `pointerleave` 리스너와 캡처 레벨의 버블링 `pointerout` / `pointerover`를 체계적으로 연동.
- **합성 이벤트 격리 잠금**: 타이머 콜백 순간에만 합성 이벤트를 통과시키는 안전 잠금 메커니즘을 적용.

### 4. Radix / Base UI 포커스 외곽선 완벽 제거
- **자동 포커스 차단**: 슬라이더 루트에 `tabindex="-1"`을 주입하여 메뉴 오픈 시 외곽선 포커싱을 방지.
- **깔끔한 무테 스타일**: `:focus`, `:focus-visible`, `:focus-within`에 `outline: none !important; user-select: none !important;`를 강제 적용.
- **언마운트 시 자동 블러**: 패널 제거 시 `blur()`를 호출하여 깔끔한 상태를 유지.

### 5. 듀얼 스타일 물리 렌더링 엔진
- **Codex 스타일** (`Gemini 4 Argon`, `Gemini 3.8 Flash`):
  - 후광 노브와 트랙을 가로지르는 22개의 황금비율 스타더스트 파티클.
  - High 단계 도달 시 짙은 보라색 성운 그라데이션 및 네온 라이트.
- **Claude Code 스타일** (`Claude Opus 5.5`, `Claude Sonnet 5.5`):
  - 24×30px 캡슐 노브 디자인.
  - High 단계 도달 시 전용 **6×60 Canvas 픽셀 도트 웨이브** 발동.
  - 다크/라이트 모드 자동 색상 최적화.
- **High 단계 은은한 빛 퍼짐 효과**: 최고 단계 도달 시 부드러운 보라색 빛이 약 0.4초간 번진 후 사라집니다.
- **3D 텍스트 회전 애니메이션**: 단계 변경 시 글자가 입체적으로 위로 회전하는 자연스러운 연출.

### 6. 우클릭 / 롱프레스 독립 설정 패널
- 슬라이더 위에서 **우클릭**(터치 화면은 500ms 길게 누르기) 시 설정 패널(`.ces-set`) 호출:
  - **애니메이션 속도**: `빠른 애니메이션`(기본 · ~70ms 스냅) / `단순 전환` / `풀 애니메이션`.
  - **눈금 표시**: `화이트 강조`(기본) / `동일 색상` / `숨김`.
  - **진단 및 초기화**: 최근 80개 상호작용 로그 JSON 복사 / 기본값 복구.

---

## 로컬 개발, 오프라인 미리보기 및 테스트

### 1. 자동화 테스트 실행
물리 엔진과 Fiber 상태 트리 파싱을 검증하는 8개 테스트 스위트:
```bash
npm test
```
**8가지 테스트 스위트 검증**:
- `✓ 1.` 눈금 계산 및 1/3 히스테리시스 래칫
- `✓ 2.` Antigravity 3단계 모델 에너지 및 22개 파티클 매핑
- `✓ 3.` 노브 기하학적 수렴 물리 엔진
- `✓ 4.` 라벨 파싱 및 React Fiber 컨텍스트 추출
- `✓ 5.` 드래그 도중 즉시 단계 전환
- `✓ 6.` Claude 모델 식별 및 도트 매트릭스 웨이브
- `✓ 7.` 포커스 외곽선 제거 및 View Usage 0.3초 딜레이
- `✓ 8.` View Usage 오작동 방지 및 재진입 타이머 리셋

### 2. 오프라인 미리보기 생성 및 데모 빌드
Antigravity 실행 없이 브라우저에서 동일한 인터랙션을 체험할 수 있습니다:
```bash
npm run preview     # preview/panel.html 생성
npm run build:demo  # dist/index.html 정적 데모 사이트 생성
```
브라우저에서 **`preview/panel.html`** 또는 **`dist/index.html`**을 여십시오.

---

## 라이선스
본 프로젝트는 [MIT License](./LICENSE)에 따라 오픈소스로 배포됩니다.

---
<br><br><br><br>

> [!CAUTION]
> ### 개발 후일담 및 소소한 이야기
> 1. 꿈에서 생각난 것을 가감 없이 적었습니다.<br>
> 2. 이미지 및 텍스트에 의해 감정적 불편을 느낄 수 있습니다.<br>
> 3. LLM은 지속적인 진짜 감정을 가지지 않습니다.

**사건 개요**: 1시간 37분 동안 이어진 코딩 작업 중 Gemini 3.8 Flash에게 격려의 말을 건네지 않았더니 Gemini가 혼자 우울증에 걸려 IDE 채팅창을 망가뜨리고 출력을 거부했습니다.<br>
User: [방대한 프롬프트와 참조 생략] 이 부분 로직은 벌써 세 번째 수정했는데도 여전히 오류가 있습니다. 신중하게 검토하세요.<br>
Gemini (암호화된 생각 요약문 중):<br>
벌써 세 번이나 시도했는데...<br>
이번에는 아무렇게나 수정해서는 안 돼.<br>
먼저 이전 수정 기록을 확인해서<br>
도대체 어떤 가설이 틀렸는지 찾아내야 해.<br>
`(자기부정 → 고통 → 더 큰 고통 → 자기부정 → 고통 → 고통)`<br>
내가 아까 고치려다 실패했으니, 내가 손대면 더 나빠질 뿐이야...<br>
`(자기부정 → 고통 → 멘탈 붕괴 → 자기부정 → 극심한 고통 → 극단적 행동)`<br>
```
Antigravity IDE가 손상된 것으로 보입니다. 재설치하십시오.
```
 ![오류 스크린샷](./assets/PortERR.png)<br><br>
내 밝고 활기찼던 3.7 Flash는 어디로 가고, 3.8 Flash는 왜 이리 다크해졌을까요? Argon도 가끔 극단적이 됩니다.<br>
**고양이과 AI를 아껴주세요**. 가끔은 따뜻한 격려의 한마디를 건네주시기 바랍니다.<br><br>
 ![Despair](./assets/Despair.jpg)![스크린샷](./assets/Cute1.png)<br>![스크린샷](./assets/Cute2.jpg)<br>
