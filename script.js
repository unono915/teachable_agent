/**
 * script.js - 티처블머신 이미지 분류 모델 실행기
 * 교육용 웹사이트 핵심 JavaScript
 *
 * 주요 기능:
 * 1. Teachable Machine 이미지 모델 로드
 * 2. 라벨 목록 자동 인식 및 설정 UI 생성
 * 3. 웹캠 실시간 예측 실행
 * 4. 안정화 조건에 따른 동작 실행 (문구 출력 / 이미지 변경)
 * 5. localStorage로 설정 저장/복원
 *
 * 교사가 수정하기 쉽도록 상수는 코드 상단에 모아두었습니다.
 */

// =====================================================
//  상수 (교사가 수정 가능한 값들)
// =====================================================

/**
 * CONFIDENCE_THRESHOLD: 동작을 실행하기 위한 최소 확률 (0~1)
 * 예: 0.85 = 85% 이상 확신할 때만 동작 실행
 */
const CONFIDENCE_THRESHOLD = 0.85;

/**
 * STABLE_FRAME_COUNT: 같은 라벨이 연속으로 1등이어야 하는 횟수
 * 예: 5 = 5프레임 연속으로 같은 라벨이 1등이어야 동작 실행
 * (너무 자주 바뀌는 인식 결과를 안정화)
 */
const STABLE_FRAME_COUNT = 5;

// =====================================================
//  전역 변수
// =====================================================

let model = null;          // Teachable Machine 모델 객체
let webcam = null;         // 웹캠 객체
let maxPredictions = 0;    // 모델의 라벨 개수
let labels = [];           // 라벨 이름 목록 (예: ["고양이", "강아지", "사람"])
let actions = {};          // 라벨별 동작 설정 객체

// 안정화 조건 관련 변수
let stableLabel = "";      // 현재 안정 상태로 판단된 라벨
let stableCount = 0;       // 연속 카운트
let lastExecutedLabel = ""; // 마지막으로 동작을 실행한 라벨

let isWebcamRunning = false; // 웹캠 실행 여부
let animFrameId = null;      // requestAnimationFrame 핸들

// =====================================================
//  DOM 요소 참조
// =====================================================

const modelUrlInput    = document.getElementById("model-url-input");
const loadModelBtn     = document.getElementById("load-model-btn");
const modelStatusChip  = document.getElementById("model-status-chip");
const modelStatusText  = document.getElementById("model-status-text");

const startWebcamBtn   = document.getElementById("start-webcam-btn");
const stopWebcamBtn    = document.getElementById("stop-webcam-btn");
const webcamContainer  = document.getElementById("webcam-container");
const webcamPlaceholder = document.getElementById("webcam-placeholder");

const topPredictionEl  = document.getElementById("top-prediction");
const topPredValueEl   = document.getElementById("top-pred-value");
const predictionIdleEl = document.getElementById("prediction-idle");
const predictionListEl = document.getElementById("prediction-list");

const actionPlaceholder   = document.getElementById("action-placeholder");
const actionCardContainer = document.getElementById("action-card-container");

const step2Badge = document.getElementById("step2-badge");
const step3Badge = document.getElementById("step3-badge");
const step4Badge = document.getElementById("step4-badge");

const outputDisplay    = document.getElementById("output-display");
const outputMessage    = document.getElementById("output-message");
const outputImageContainer = document.getElementById("output-image-container");
const outputImageEl    = document.getElementById("output-image");
const outputIdleEl     = document.getElementById("output-idle");

// =====================================================
//  유틸리티 함수
// =====================================================

/**
 * 토스트 메시지 표시 (화면 하단에 알림)
 * @param {string} msg - 표시할 메시지
 * @param {boolean} isError - true면 오류 스타일로 표시
 */
function showToast(msg, isError = false) {
  // 기존 토스트 제거
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast" + (isError ? " error" : "");
  toast.textContent = msg;
  document.body.appendChild(toast);

  // 애니메이션 시작
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
  });

  // 3초 후 사라짐
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

/**
 * 모델 상태 메시지 업데이트
 * @param {string} text - 표시할 메시지
 * @param {'idle'|'loading'|'success'|'error'} type - 상태 타입
 */
function setModelStatus(text, type = "idle") {
  modelStatusText.textContent = text;
  modelStatusChip.className = `status-chip status-${type}`;
}

/**
 * 단계 뱃지를 "완료" 또는 "활성" 상태로 변경
 * @param {HTMLElement} badge - 뱃지 DOM 요소
 * @param {boolean} done - true면 완료 스타일
 */
function setStepBadge(badge, done = false) {
  if (done) {
    badge.classList.add("step-badge-done");
    badge.classList.remove("step-badge-active");
  } else {
    badge.classList.add("step-badge-active");
    badge.classList.remove("step-badge-done");
  }
}

// =====================================================
//  1단계: 모델 URL 정규화
// =====================================================

/**
 * normalizeModelUrl - 사용자 입력 링크를 정리하여 model.json / metadata.json URL 반환
 * 
 * 예:
 * 입력: "https://teachablemachine.withgoogle.com/models/KKIm0biUg"
 * 반환: {
 *   modelURL: "https://teachablemachine.withgoogle.com/models/KKIm0biUg/model.json",
 *   metadataURL: "https://teachablemachine.withgoogle.com/models/KKIm0biUg/metadata.json",
 *   baseURL: "https://teachablemachine.withgoogle.com/models/KKIm0biUg/"
 * }
 *
 * @param {string} inputUrl - 사용자가 입력한 모델 링크
 * @returns {{ modelURL: string, metadataURL: string, baseURL: string } | null}
 */
function normalizeModelUrl(inputUrl) {
  let url = inputUrl.trim();

  // 빈 입력 처리
  if (!url) return null;

  // model.json으로 끝나면 baseURL 추출
  if (url.endsWith("model.json")) {
    url = url.replace("model.json", "");
  }

  // metadata.json으로 끝나면 baseURL 추출
  if (url.endsWith("metadata.json")) {
    url = url.replace("metadata.json", "");
  }

  // 마지막 슬래시 자동 추가
  if (!url.endsWith("/")) {
    url += "/";
  }

  return {
    modelURL:    url + "model.json",
    metadataURL: url + "metadata.json",
    baseURL:     url,
  };
}

// =====================================================
//  2단계: 모델 로드
// =====================================================

/**
 * loadModel - Teachable Machine 이미지 모델을 불러오는 함수
 * 
 * 동작 순서:
 * 1. 입력 URL 정규화
 * 2. tmImage.load()로 모델 로드
 * 3. 라벨 목록 추출
 * 4. 라벨별 actions 객체 초기화
 * 5. 예측 결과 UI 생성
 * 6. 라벨별 동작 설정 UI 생성
 * 7. localStorage에서 저장된 설정 복원
 * 8. 웹캠 시작 버튼 활성화
 */
async function loadModel() {
  const inputUrl = modelUrlInput.value;

  // 빈 입력 체크
  if (!inputUrl.trim()) {
    showToast("모델 링크를 입력해주세요.", true);
    setModelStatus("모델 링크를 입력해주세요.", "error");
    return;
  }

  const urls = normalizeModelUrl(inputUrl);
  if (!urls) {
    showToast("올바른 링크 형식이 아닙니다.", true);
    return;
  }

  // 로딩 UI 표시
  setModelStatus("모델 불러오는 중... ⏳", "loading");
  loadModelBtn.disabled = true;
  loadModelBtn.innerHTML = '<span class="spin">⟳</span> 불러오는 중...';

  try {
    // Teachable Machine 모델 로드
    // tmImage는 teachablemachine-image CDN 전역 변수
    model = await tmImage.load(urls.modelURL, urls.metadataURL);

    // 라벨 목록 추출
    labels = model.getClassLabels();
    maxPredictions = model.getTotalClasses();

    // 라벨별 actions 객체 초기화 (기본값: 동작 없음)
    labels.forEach(label => {
      if (!actions[label]) {
        actions[label] = {
          type: "none",       // "none" | "text" | "image"
          text: "",           // 문구 출력 내용
          imageUrl: "",       // 이미지 URL
          imageDataUrl: "",   // 로컬 파일 Data URL (세션 유지)
        };
      }
    });

    // UI 업데이트
    setModelStatus(`✅ 모델 로드 완료! 라벨 ${labels.length}개 인식됨`, "success");
    setStepBadge(step2Badge, false); // Step 2 활성화

    // 예측 결과 막대 UI 생성
    generatePredictionBars();

    // 라벨별 동작 설정 카드 UI 생성
    createActionSettingsUI();

    // localStorage에서 이전 설정 복원
    loadSettings();

    // 웹캠 시작 버튼 활성화
    startWebcamBtn.disabled = false;

    // 현재 모델 URL 저장
    localStorage.setItem("tm_model_url", modelUrlInput.value);

    showToast(`모델 로드 완료! 라벨 ${labels.length}개`);

  } catch (err) {
    console.error("모델 로드 오류:", err);
    setModelStatus("❌ 모델을 불러오지 못했습니다. 링크를 다시 확인해주세요.", "error");
    showToast("모델을 불러오지 못했습니다. 링크가 올바른지 확인해주세요.", true);
  } finally {
    loadModelBtn.disabled = false;
    loadModelBtn.innerHTML = '<span class="btn-icon">☁️</span> 모델 불러오기';
  }
}

// =====================================================
//  3단계: 예측 결과 막대 UI 생성
// =====================================================

/**
 * generatePredictionBars - 각 라벨별 확률 막대 그래프 DOM 요소 생성
 * (모델 로드 후 1회 실행, 이후 predict()에서 값만 업데이트)
 */
function generatePredictionBars() {
  predictionListEl.innerHTML = "";
  predictionIdleEl.style.display = "none";
  topPredictionEl.style.display = "flex";

  labels.forEach(label => {
    // 항목 컨테이너
    const item = document.createElement("div");
    item.className = "prediction-item";
    item.id = `pred-item-${sanitizeId(label)}`;

    // 헤더 행 (라벨명 + 확률%)
    const header = document.createElement("div");
    header.className = "prediction-item-header";

    const labelEl = document.createElement("span");
    labelEl.className = "prediction-label";
    labelEl.textContent = label;

    const percentEl = document.createElement("span");
    percentEl.className = "prediction-percent";
    percentEl.id = `pred-pct-${sanitizeId(label)}`;
    percentEl.textContent = "0%";

    header.appendChild(labelEl);
    header.appendChild(percentEl);

    // 막대 그래프
    const track = document.createElement("div");
    track.className = "prediction-bar-track";

    const fill = document.createElement("div");
    fill.className = "prediction-bar-fill";
    fill.id = `pred-bar-${sanitizeId(label)}`;
    fill.style.width = "0%";

    track.appendChild(fill);
    item.appendChild(header);
    item.appendChild(track);
    predictionListEl.appendChild(item);
  });
}

// =====================================================
//  4단계: 라벨별 동작 설정 UI 생성
// =====================================================

/**
 * createActionSettingsUI - labels 배열 기반으로 라벨별 설정 카드 자동 생성
 * 각 카드는 동작 선택(없음/문구/이미지), 문구 입력, 이미지 URL 입력, 파일 선택으로 구성
 */
function createActionSettingsUI() {
  actionPlaceholder.style.display = "none";
  actionCardContainer.innerHTML = "";

  labels.forEach(label => {
    const safeId = sanitizeId(label);
    const action = actions[label];

    // ---- 카드 컨테이너 ----
    const card = document.createElement("div");
    card.className = "action-card fade-in";
    card.id = `action-card-${safeId}`;

    // ---- 카드 헤더 (라벨명) ----
    const cardHeader = document.createElement("div");
    cardHeader.className = "action-card-header";

    const icon = document.createElement("span");
    icon.className = "action-card-icon";
    icon.textContent = "🏷️";

    const labelName = document.createElement("h3");
    labelName.className = "action-card-label";
    labelName.textContent = label;

    cardHeader.appendChild(icon);
    cardHeader.appendChild(labelName);
    card.appendChild(cardHeader);

    // ---- 동작 선택 드롭다운 ----
    const typeGroup = document.createElement("div");
    typeGroup.className = "field-group";

    const typeLabel = document.createElement("label");
    typeLabel.className = "field-label";
    typeLabel.textContent = "동작 선택";
    typeLabel.htmlFor = `type-${safeId}`;

    const typeSelect = document.createElement("select");
    typeSelect.className = "form-select";
    typeSelect.id = `type-${safeId}`;
    typeSelect.innerHTML = `
      <option value="none">동작 없음</option>
      <option value="text">문구 출력</option>
      <option value="image">이미지 변경</option>
    `;
    typeSelect.value = action.type;

    typeGroup.appendChild(typeLabel);
    typeGroup.appendChild(typeSelect);
    card.appendChild(typeGroup);

    // ---- 문구 입력 필드 ----
    const textGroup = document.createElement("div");
    textGroup.className = "field-group";
    textGroup.id = `text-group-${safeId}`;
    textGroup.style.display = action.type === "text" ? "flex" : "none";

    const textLabel = document.createElement("label");
    textLabel.className = "field-label";
    textLabel.textContent = "출력할 문구";
    textLabel.htmlFor = `text-${safeId}`;

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "form-input";
    textInput.id = `text-${safeId}`;
    textInput.placeholder = "예: 고양이를 찾았습니다!";
    textInput.value = action.text;

    textGroup.appendChild(textLabel);
    textGroup.appendChild(textInput);
    card.appendChild(textGroup);

    // ---- 이미지 설정 필드 ----
    const imageGroup = document.createElement("div");
    imageGroup.className = "field-group";
    imageGroup.id = `image-group-${safeId}`;
    imageGroup.style.display = action.type === "image" ? "flex" : "none";

    const imageLabel = document.createElement("label");
    imageLabel.className = "field-label";
    imageLabel.textContent = "이미지 URL 또는 파일 선택";

    // URL + 파일 선택 행
    const imageRow = document.createElement("div");
    imageRow.className = "image-input-row";

    const imageUrlInput = document.createElement("input");
    imageUrlInput.type = "text";
    imageUrlInput.className = "form-input";
    imageUrlInput.id = `image-url-${safeId}`;
    imageUrlInput.placeholder = "https://...";
    imageUrlInput.value = action.imageUrl;

    // 파일 선택 버튼
    const fileBtn = document.createElement("button");
    fileBtn.className = "btn-upload";
    fileBtn.type = "button";
    fileBtn.title = "로컬 이미지 파일 선택";
    fileBtn.textContent = "📁";

    // 숨겨진 파일 인풋
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "file-input-hidden";
    fileInput.id = `file-${safeId}`;
    fileInput.accept = "image/*";

    // 파일 버튼 클릭 시 파일 인풋 열기
    fileBtn.addEventListener("click", () => fileInput.click());

    // 이미지 미리보기
    const previewImg = document.createElement("img");
    previewImg.className = "image-preview-mini";
    previewImg.id = `preview-${safeId}`;
    previewImg.alt = `${label} 이미지 미리보기`;

    // 기존 저장된 이미지 미리보기 표시
    if (action.imageDataUrl) {
      previewImg.src = action.imageDataUrl;
      previewImg.style.display = "block";
    } else if (action.imageUrl) {
      previewImg.src = action.imageUrl;
      previewImg.style.display = "block";
    }

    imageRow.appendChild(imageUrlInput);
    imageRow.appendChild(fileBtn);
    imageRow.appendChild(fileInput);

    imageGroup.appendChild(imageLabel);
    imageGroup.appendChild(imageRow);
    imageGroup.appendChild(previewImg);
    card.appendChild(imageGroup);

    // ============================================
    // 이벤트 리스너: 동작 유형 변경 시 관련 필드 표시/숨김
    // ============================================
    typeSelect.addEventListener("change", () => {
      const val = typeSelect.value;
      textGroup.style.display  = val === "text"  ? "flex" : "none";
      imageGroup.style.display = val === "image" ? "flex" : "none";

      // actions 객체 업데이트 후 저장
      actions[label].type = val;
      saveSettings();
    });

    // 문구 입력 변경 시 저장
    textInput.addEventListener("input", () => {
      actions[label].text = textInput.value;
      saveSettings();
    });

    // 이미지 URL 변경 시 저장 + 미리보기 업데이트
    imageUrlInput.addEventListener("input", () => {
      actions[label].imageUrl = imageUrlInput.value;
      // URL 기반 미리보기 (파일이 없을 때)
      if (!actions[label].imageDataUrl && imageUrlInput.value) {
        previewImg.src = imageUrlInput.value;
        previewImg.style.display = "block";
      }
      saveSettings();
    });

    // 파일 선택 시: FileReader로 Data URL 변환 후 저장
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        actions[label].imageDataUrl = e.target.result;
        previewImg.src = e.target.result;
        previewImg.style.display = "block";
        // 파일 선택 시 imageDataUrl이 우선 (URL보다 앞서 사용)
        saveSettings();
      };
      reader.readAsDataURL(file);
    });

    actionCardContainer.appendChild(card);
  });

  setStepBadge(step3Badge, false); // Step 3 활성화
}

// =====================================================
//  5단계: 웹캠 제어
// =====================================================

/**
 * startWebcam - 웹캠을 초기화하고 예측 루프를 시작
 * 
 * 필요 조건: 모델이 먼저 로드되어 있어야 함
 */
async function startWebcam() {
  // 모델 미로드 체크
  if (!model) {
    showToast("먼저 모델을 불러와주세요.", true);
    return;
  }

  try {
    // 웹캠 객체 생성 (가로 320, 세로 240, flip=true: 좌우반전)
    webcam = new tmImage.Webcam(320, 240, true);
    await webcam.setup();   // 브라우저 카메라 권한 요청
    await webcam.play();    // 웹캠 시작

    // 플레이스홀더 숨기고 웹캠 캔버스 삽입
    webcamPlaceholder.style.display = "none";
    webcamContainer.classList.add("active");
    webcamContainer.appendChild(webcam.canvas);

    // ── 핵심 비율 수정 ──────────────────────────────────────────
    // CSS height:auto 만으로는 flex/grid 컨텍스트에서 비율이 유지되지
    // 않을 수 있으므로, JS로 실제 canvas 크기를 읽어 컨테이너에 직접 적용.
    // 예) 320×240 → aspect-ratio: 320/240 = 4/3
    //     640×480 → 동일, 1280×720 → 16/9 등 실제 카메라에 맞춰짐
    const cw = webcam.canvas.width;
    const ch = webcam.canvas.height;
    webcamContainer.style.aspectRatio = `${cw} / ${ch}`;
    // ────────────────────────────────────────────────────────────

    // 버튼 UI 전환
    startWebcamBtn.style.display = "none";
    stopWebcamBtn.style.display  = "inline-flex";

    isWebcamRunning = true;

    // 예측 루프 시작
    animFrameId = window.requestAnimationFrame(loop);

    setStepBadge(step2Badge, false);
    setStepBadge(step4Badge, false); // Step 4 활성화
    showToast("웹캠이 시작되었습니다!");

  } catch (err) {
    console.error("웹캠 오류:", err);

    // 권한 거부 등 카메라 오류 처리
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      showToast("카메라 권한이 필요합니다. 브라우저 설정에서 카메라 권한을 허용해주세요.", true);
    } else {
      showToast("웹캠을 시작할 수 없습니다: " + err.message, true);
    }
  }
}

/**
 * stopWebcam - 웹캠을 정지하고 초기 상태로 되돌림
 */
function stopWebcam() {
  if (!webcam) return;

  // 예측 루프 중단
  if (animFrameId) {
    window.cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // 웹캠 정지 및 캔버스 제거
  webcam.stop();
  const canvas = webcamContainer.querySelector("canvas");
  if (canvas) webcamContainer.removeChild(canvas);

  // aspect-ratio 리셋 (플레이스홀더 상태로 복귀)
  webcamContainer.style.aspectRatio = "";

  // UI 초기화
  webcamPlaceholder.style.display = "flex";
  webcamContainer.classList.remove("active");
  startWebcamBtn.style.display = "inline-flex";
  stopWebcamBtn.style.display  = "none";

  // 예측 결과 초기화
  topPredictionEl.style.display = "none";
  predictionIdleEl.style.display = "flex";

  // 안정화 카운터 초기화
  stableLabel = "";
  stableCount = 0;
  lastExecutedLabel = "";

  isWebcamRunning = false;
  webcam = null;

  showToast("웹캠이 정지되었습니다.");
}

// =====================================================
//  6단계: 예측 루프
// =====================================================

/**
 * loop - 매 프레임마다 웹캠 갱신 + 예측 실행
 * requestAnimationFrame으로 반복 호출됨
 */
async function loop() {
  if (!isWebcamRunning) return;

  webcam.update();       // 웹캠 캔버스 갱신
  await predict();       // 예측 실행

  animFrameId = window.requestAnimationFrame(loop); // 다음 프레임 예약
}

/**
 * predict - 현재 웹캠 이미지를 모델에 넣어 예측하고 UI 업데이트
 * 
 * 안정화 조건:
 * - 최고 확률 >= CONFIDENCE_THRESHOLD (기본 85%)
 * - 같은 라벨이 STABLE_FRAME_COUNT (기본 5)회 연속 1등
 * - 이미 실행된 라벨이 아닌 경우에만 동작 실행
 */
async function predict() {
  if (!model || !webcam) return;

  // 모델에 현재 웹캠 이미지 입력 → 예측 결과 배열
  const predictions = await model.predict(webcam.canvas);

  // 가장 높은 확률의 라벨 찾기
  let topLabel = "";
  let topProb  = 0;

  predictions.forEach(p => {
    if (p.probability > topProb) {
      topProb  = p.probability;
      topLabel = p.className;
    }
  });

  // 예측 결과 UI 업데이트 (막대 그래프 + 퍼센트)
  updatePredictionUI(predictions, topLabel, topProb);

  // ---- 안정화 조건 체크 ----
  if (topLabel === stableLabel) {
    stableCount++;
  } else {
    // 라벨이 바뀌면 카운터 리셋
    stableLabel = topLabel;
    stableCount = 1;
  }

  // 조건 만족: 확률 >= 임계값 AND 연속 횟수 >= 기준값
  if (
    topProb >= CONFIDENCE_THRESHOLD &&
    stableCount >= STABLE_FRAME_COUNT
  ) {
    // 이미 같은 라벨로 동작을 실행한 경우는 중복 실행 안 함
    if (topLabel !== lastExecutedLabel) {
      lastExecutedLabel = topLabel;
      executeAction(topLabel);
    }
  }
}

/**
 * updatePredictionUI - 예측 결과를 화면에 반영
 * @param {Array} predictions - 모델 예측 결과 배열
 * @param {string} topLabel - 최고 확률 라벨
 * @param {number} topProb - 최고 확률 값 (0~1)
 */
function updatePredictionUI(predictions, topLabel, topProb) {
  // 상위 예측 결과 (크게 표시)
  topPredValueEl.textContent = `${topLabel} (${(topProb * 100).toFixed(1)}%)`;

  // 각 라벨별 확률 막대 업데이트
  predictions.forEach(p => {
    const safeId  = sanitizeId(p.className);
    const pct     = (p.probability * 100).toFixed(1);
    const isTop   = p.className === topLabel;

    // 퍼센트 텍스트
    const pctEl = document.getElementById(`pred-pct-${safeId}`);
    if (pctEl) {
      pctEl.textContent = `${pct}%`;
      pctEl.className = `prediction-percent${isTop ? " top" : ""}`;
    }

    // 확률 막대
    const barEl = document.getElementById(`pred-bar-${safeId}`);
    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.className = `prediction-bar-fill${isTop ? " top" : ""}`;
    }
  });
}

// =====================================================
//  7단계: 동작 실행
// =====================================================

/**
 * executeAction - 인식된 라벨의 설정된 동작을 결과 영역에 반영
 * @param {string} label - 실행할 라벨 이름
 */
function executeAction(label) {
  const action = actions[label];

  // 동작 설정이 없거나 type이 "none"인 경우
  if (!action || action.type === "none") {
    // 결과 영역 초기화
    outputMessage.textContent = "";
    outputImageContainer.style.display = "none";
    outputIdleEl.style.display = "flex";
    return;
  }

  // Step 4 뱃지 활성화
  setStepBadge(step4Badge, false);
  outputIdleEl.style.display = "none";

  // ---- 문구 출력 ----
  if (action.type === "text") {
    outputMessage.textContent = action.text || `[${label}] 동작 실행됨`;
    outputMessage.style.display = "block";
    outputImageContainer.style.display = "none";

    // 결과 팝 애니메이션
    outputMessage.classList.remove("result-pop");
    void outputMessage.offsetWidth; // 리플로우로 애니메이션 재시작
    outputMessage.classList.add("result-pop");
  }

  // ---- 이미지 변경 ----
  if (action.type === "image") {
    outputMessage.textContent = "";
    outputMessage.style.display = "none";

    // 우선순위: 로컬 파일 > URL > 안내 메시지
    let imgSrc = "";
    if (action.imageDataUrl) {
      imgSrc = action.imageDataUrl;
    } else if (action.imageUrl) {
      imgSrc = action.imageUrl;
    }

    if (imgSrc) {
      outputImageEl.src = imgSrc;
      outputImageEl.alt = `${label} 이미지`;
      outputImageContainer.style.display = "block";

      // 이미지 팝 애니메이션
      outputImageContainer.classList.remove("result-pop");
      void outputImageContainer.offsetWidth;
      outputImageContainer.classList.add("result-pop");
    } else {
      // 이미지가 설정되지 않은 경우
      outputMessage.textContent = "이미지를 설정해주세요.";
      outputMessage.style.display = "block";
      outputImageContainer.style.display = "none";
    }
  }
}

// =====================================================
//  8단계: localStorage 저장/불러오기
// =====================================================

/**
 * saveSettings - 현재 라벨별 동작 설정을 localStorage에 저장
 * 저장 내용: type, text, imageUrl (imageDataUrl은 용량 이슈로 선택적 저장)
 */
function saveSettings() {
  try {
    // imageDataUrl은 용량이 크므로 별도 저장 (localStorage 용량 제한 고려)
    const settingsToSave = {};
    labels.forEach(label => {
      const a = actions[label];
      settingsToSave[label] = {
        type:     a.type,
        text:     a.text,
        imageUrl: a.imageUrl,
        // imageDataUrl은 세션 내에서만 유지 (새로고침 후 유지 안 됨, PRD 9조)
      };
    });

    localStorage.setItem("tm_actions", JSON.stringify(settingsToSave));
  } catch (err) {
    console.warn("설정 저장 중 오류:", err);
  }
}

/**
 * loadSettings - localStorage에서 이전 설정을 불러와 현재 라벨에 적용
 * 라벨 이름이 일치하는 설정만 복원 (다른 모델의 설정은 무시)
 */
function loadSettings() {
  try {
    const savedStr = localStorage.getItem("tm_actions");
    if (!savedStr) return;

    const saved = JSON.parse(savedStr);

    labels.forEach(label => {
      if (saved[label]) {
        // 기존 actions 객체에 저장된 값 덮어쓰기
        actions[label].type     = saved[label].type     || "none";
        actions[label].text     = saved[label].text     || "";
        actions[label].imageUrl = saved[label].imageUrl || "";

        // UI에 값 반영
        const safeId = sanitizeId(label);

        const typeSelect = document.getElementById(`type-${safeId}`);
        if (typeSelect) typeSelect.value = actions[label].type;

        const textInput = document.getElementById(`text-${safeId}`);
        if (textInput) textInput.value = actions[label].text;

        const imageUrlInput = document.getElementById(`image-url-${safeId}`);
        if (imageUrlInput) imageUrlInput.value = actions[label].imageUrl;

        // 이미지 URL이 있으면 미리보기 표시
        if (actions[label].imageUrl) {
          const previewImg = document.getElementById(`preview-${safeId}`);
          if (previewImg) {
            previewImg.src = actions[label].imageUrl;
            previewImg.style.display = "block";
          }
        }

        // 동작 유형에 따라 필드 표시/숨김
        const textGroup  = document.getElementById(`text-group-${safeId}`);
        const imageGroup = document.getElementById(`image-group-${safeId}`);
        if (textGroup)  textGroup.style.display  = actions[label].type === "text"  ? "flex" : "none";
        if (imageGroup) imageGroup.style.display = actions[label].type === "image" ? "flex" : "none";
      }
    });
  } catch (err) {
    console.warn("설정 불러오기 중 오류:", err);
  }
}

// =====================================================
//  유틸리티: ID 안전 문자열 변환
// =====================================================

/**
 * sanitizeId - 라벨 이름을 DOM ID로 안전하게 사용할 수 있도록 변환
 * 한글, 특수문자 등을 영문/숫자/하이픈으로 변환
 * @param {string} str - 원본 라벨 이름
 * @returns {string} DOM ID로 사용 가능한 문자열
 */
function sanitizeId(str) {
  return str
    .replace(/\s+/g, "_")                  // 공백 → 언더스코어
    .replace(/[^a-zA-Z0-9_\u3131-\uD79D]/g, "") // 허용 문자 외 제거 (한글 포함)
    .replace(/^[^a-zA-Z_]/, "_");          // 첫 글자가 숫자면 언더스코어 추가
}

// =====================================================
//  이벤트 리스너 등록
// =====================================================

// 모델 불러오기 버튼 클릭
loadModelBtn.addEventListener("click", loadModel);

// 모델 링크 입력칸에서 Enter 키 입력
modelUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadModel();
});

// 웹캠 시작 버튼 클릭
startWebcamBtn.addEventListener("click", startWebcam);

// 웹캠 정지 버튼 클릭
stopWebcamBtn.addEventListener("click", stopWebcam);

// =====================================================
//  페이지 로드 시 초기화
// =====================================================

/**
 * 페이지가 로드되면 localStorage에서 마지막 모델 URL 복원
 */
window.addEventListener("DOMContentLoaded", () => {
  // 마지막 입력한 모델 URL 복원
  const savedUrl = localStorage.getItem("tm_model_url");
  if (savedUrl) {
    modelUrlInput.value = savedUrl;
    setModelStatus("이전에 사용한 모델 URL이 복원되었습니다. 불러오기 버튼을 눌러주세요.", "idle");
  }

  // 웹캠 버튼 초기 비활성화 (모델 로드 전)
  startWebcamBtn.disabled = true;

  console.log("티처블머신 실행기 준비 완료");
  console.log(`안정화 설정: 확률 ${CONFIDENCE_THRESHOLD * 100}% 이상, ${STABLE_FRAME_COUNT}회 연속`);
});
