const CONFIG = {
  GEM_URL: "https://gemini.google.com/gem/5a5c656ed10d?usp=sharing",
  DEFAULT_CONFIDENCE_THRESHOLD: 0.8,
  ENABLE_IMAGE_UPLOAD: true,
  SAMPLE_MODEL_URL: "https://teachablemachine.withgoogle.com/models/Hf9Rr15V_/",
};

const STORAGE_KEYS = {
  modelUrl: "tm_action_site_model_url",
  settingsPrefix: "tm_action_site_settings:",
};

const state = {
  model: null,
  labels: [],
  actions: {},
  threshold: CONFIG.DEFAULT_CONFIDENCE_THRESHOLD,
  modelBaseUrl: "",
  video: null,
  stream: null,
  animationId: null,
  running: false,
  stableLabel: "",
  stableCount: 0,
  lastExecutedLabel: "",
};

const els = {
  menuToggle: document.querySelector("#menu-toggle"),
  navMenu: document.querySelector("#nav-menu"),
  modelUrlInput: document.querySelector("#model-url-input"),
  loadModelBtn: document.querySelector("#load-model-btn"),
  useSampleBtn: document.querySelector("#use-sample-btn"),
  copyModelUrlBtn: document.querySelector("#copy-model-url-btn"),
  modelStatus: document.querySelector("#model-status"),
  labelList: document.querySelector("#label-list"),
  thresholdInput: document.querySelector("#threshold-input"),
  thresholdValue: document.querySelector("#threshold-value"),
  exportSettingsBtn: document.querySelector("#export-settings-btn"),
  importSettingsInput: document.querySelector("#import-settings-input"),
  resetSettingsBtn: document.querySelector("#reset-settings-btn"),
  actionEmpty: document.querySelector("#action-empty"),
  actionGrid: document.querySelector("#action-grid"),
  startWebcamBtn: document.querySelector("#start-webcam-btn"),
  stopWebcamBtn: document.querySelector("#stop-webcam-btn"),
  webcamBox: document.querySelector("#webcam-box"),
  webcamPlaceholder: document.querySelector("#webcam-placeholder"),
  topResult: document.querySelector("#top-result"),
  predictionBars: document.querySelector("#prediction-bars"),
  outputBox: document.querySelector("#output-box"),
  outputPlaceholder: document.querySelector("#output-placeholder"),
  outputMessage: document.querySelector("#output-message"),
  outputImage: document.querySelector("#output-image"),
  toast: document.querySelector("#toast"),
};

function setStatus(message, type = "info") {
  els.modelStatus.textContent = message;
  els.modelStatus.dataset.type = type;
}

function showToast(message, type = "info") {
  els.toast.textContent = message;
  els.toast.dataset.type = type;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2800);
}

function normalizeModelUrl(input) {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Teachable Machine 모델 링크를 입력해 주세요.");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("링크 형식이 올바르지 않습니다. https:// 로 시작하는 모델 링크를 넣어 주세요.");
  }

  if (url.hostname !== "teachablemachine.withgoogle.com") {
    throw new Error("Teachable Machine 모델 링크만 사용할 수 있습니다.");
  }

  let base = url.href.replace(/(model|metadata)\.json(\?.*)?$/i, "");
  base = base.split("?")[0].split("#")[0];
  if (!base.endsWith("/")) base += "/";

  if (!/\/models\/[^/]+\/$/i.test(new URL(base).pathname)) {
    throw new Error("공유 링크는 /models/모델ID/ 형태여야 합니다.");
  }

  return {
    base,
    modelURL: `${base}model.json`,
    metadataURL: `${base}metadata.json`,
  };
}

function waitForTmImage(timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (window.tmImage) {
      resolve();
      return;
    }

    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.tmImage) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        window.clearInterval(timer);
        reject(new Error("Teachable Machine 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요."));
      }
    }, 150);
  });
}

async function loadModel() {
  let urls;
  try {
    urls = normalizeModelUrl(els.modelUrlInput.value);
  } catch (error) {
    setStatus(error.message, "error");
    showToast(error.message, "error");
    return;
  }

  els.loadModelBtn.disabled = true;
  setStatus("모델을 불러오는 중입니다.", "loading");

  try {
    await waitForTmImage();
    const loadedModel = await window.tmImage.load(urls.modelURL, urls.metadataURL);
    const labels = loadedModel.getClassLabels();

    if (!labels.length) {
      throw new Error("라벨 정보를 찾을 수 없습니다. 모델을 다시 업로드해 주세요.");
    }

    stopWebcam();
    state.model = loadedModel;
    state.labels = labels;
    state.modelBaseUrl = urls.base;
    state.actions = {};
    labels.forEach((label) => {
      state.actions[label] = {
        enabled: true,
        outputType: "text",
        text: `${label} 라벨이 인식되었습니다.`,
        imageUrl: "",
        imageDataUrl: "",
      };
    });

    restoreSettings();
    localStorage.setItem(STORAGE_KEYS.modelUrl, urls.base);
    els.modelUrlInput.value = urls.base;
    renderLabels();
    renderActionCards();
    renderPredictionBars([]);
    updateThresholdFromInput();
    els.startWebcamBtn.disabled = false;
    clearOutput();
    setStatus(`모델을 불러왔습니다. 감지된 라벨: ${labels.join(", ")}`, "success");
    showToast("모델 연결이 완료되었습니다.");
  } catch (error) {
    state.model = null;
    els.startWebcamBtn.disabled = true;
    setStatus(modelLoadErrorMessage(error), "error");
    showToast("모델을 불러오지 못했습니다.", "error");
  } finally {
    els.loadModelBtn.disabled = false;
  }
}

function modelLoadErrorMessage(error) {
  const message = String(error?.message || error).toLowerCase();
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "모델 파일을 가져오지 못했습니다. 인터넷 연결과 모델 공개 상태를 확인해 주세요.";
  }
  if (message.includes("404") || message.includes("not found")) {
    return "모델을 찾을 수 없습니다. 링크가 정확한지 확인해 주세요.";
  }
  if (message.includes("json")) {
    return "모델 파일 형식이 올바르지 않습니다. 이미지 분류 모델 링크인지 확인해 주세요.";
  }
  return error?.message || "알 수 없는 오류로 모델을 불러오지 못했습니다.";
}

function renderLabels() {
  els.labelList.innerHTML = "";
  state.labels.forEach((label) => {
    const chip = document.createElement("span");
    chip.className = "label-chip";
    chip.textContent = label;
    els.labelList.appendChild(chip);
  });
}

function renderActionCards() {
  els.actionGrid.innerHTML = "";
  els.actionEmpty.hidden = state.labels.length > 0;

  state.labels.forEach((label) => {
    const action = state.actions[label];
    const card = document.createElement("article");
    card.className = "action-card";
    card.innerHTML = `
      <div class="action-card-header">
        <h3></h3>
        <label class="switch">
          <input type="checkbox" ${action.enabled ? "checked" : ""} data-field="enabled" />
          <span>사용</span>
        </label>
      </div>
      <label class="field">
        <span>출력 유형</span>
        <select data-field="outputType">
          <option value="text">문구</option>
          <option value="image">이미지</option>
          <option value="both">문구 + 이미지</option>
        </select>
      </label>
      <label class="field text-field">
        <span>출력 문구</span>
        <textarea data-field="text" rows="3" placeholder="라벨이 인식되면 보여 줄 문구를 적으세요."></textarea>
      </label>
      <label class="field image-field">
        <span>이미지 URL</span>
        <input data-field="imageUrl" type="url" placeholder="https://..." />
      </label>
      <label class="file-drop image-upload-field">
        <input data-field="imageFile" type="file" accept="image/*" />
        <span>로컬 이미지 선택</span>
      </label>
      <div class="preview">
        <strong>미리보기</strong>
        <p></p>
        <img alt="" />
      </div>
    `;

    card.querySelector("h3").textContent = label;
    card.querySelector('[data-field="outputType"]').value = action.outputType;
    card.querySelector('[data-field="text"]').value = action.text;
    card.querySelector('[data-field="imageUrl"]').value = action.imageUrl;

    card.addEventListener("input", (event) => {
      updateActionFromCard(label, card, event);
    });
    card.addEventListener("change", (event) => {
      updateActionFromCard(label, card, event);
    });

    updateActionCardVisibility(card, action);
    updatePreview(card, action);
    els.actionGrid.appendChild(card);
  });
}

function updateActionFromCard(label, card, event) {
  const action = state.actions[label];
  const field = event.target.dataset.field;

  if (field === "enabled") action.enabled = event.target.checked;
  if (field === "outputType") action.outputType = event.target.value;
  if (field === "text") action.text = event.target.value;
  if (field === "imageUrl") {
    action.imageUrl = event.target.value;
    if (event.target.value) action.imageDataUrl = "";
  }
  if (field === "imageFile" && event.target.files?.[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      action.imageDataUrl = reader.result;
      action.imageUrl = "";
      card.querySelector('[data-field="imageUrl"]').value = "";
      updatePreview(card, action);
      saveSettings();
    };
    reader.readAsDataURL(event.target.files[0]);
  }

  updateActionCardVisibility(card, action);
  updatePreview(card, action);
  saveSettings();
}

function updateActionCardVisibility(card, action) {
  const usesText = action.outputType === "text" || action.outputType === "both";
  const usesImage = action.outputType === "image" || action.outputType === "both";
  card.querySelector(".text-field").hidden = !usesText;
  card.querySelector(".image-field").hidden = !usesImage;
  card.querySelector(".image-upload-field").hidden = !usesImage || !CONFIG.ENABLE_IMAGE_UPLOAD;
}

function updatePreview(card, action) {
  const previewText = card.querySelector(".preview p");
  const previewImg = card.querySelector(".preview img");
  const usesText = action.outputType === "text" || action.outputType === "both";
  const usesImage = action.outputType === "image" || action.outputType === "both";
  const src = action.imageDataUrl || action.imageUrl;

  previewText.textContent = usesText ? action.text || "문구가 아직 없습니다." : "문구를 출력하지 않습니다.";
  previewImg.hidden = !usesImage || !src;
  if (usesImage && src) previewImg.src = src;
}

function saveSettings() {
  if (!state.modelBaseUrl) return;
  const payload = {
    modelUrl: state.modelBaseUrl,
    threshold: state.threshold,
    actions: state.actions,
  };
  localStorage.setItem(`${STORAGE_KEYS.settingsPrefix}${state.modelBaseUrl}`, JSON.stringify(payload));
}

function restoreSettings() {
  const saved = localStorage.getItem(`${STORAGE_KEYS.settingsPrefix}${state.modelBaseUrl}`);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    state.threshold = Number(parsed.threshold) || CONFIG.DEFAULT_CONFIDENCE_THRESHOLD;
    els.thresholdInput.value = Math.round(state.threshold * 100);
    state.labels.forEach((label) => {
      if (parsed.actions?.[label]) {
        state.actions[label] = {
          ...state.actions[label],
          ...parsed.actions[label],
        };
      }
    });
  } catch {
    showToast("저장된 설정을 읽지 못했습니다.", "error");
  }
}

function exportSettings() {
  if (!state.modelBaseUrl) {
    showToast("먼저 모델을 불러와 주세요.", "error");
    return;
  }
  const payload = {
    modelUrl: state.modelBaseUrl,
    threshold: state.threshold,
    labels: state.labels,
    actions: state.actions,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "teachable-machine-action-settings.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importSettings(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.modelUrl) {
      els.modelUrlInput.value = parsed.modelUrl;
    }
    if (parsed.threshold) {
      state.threshold = Number(parsed.threshold);
      els.thresholdInput.value = Math.round(state.threshold * 100);
      updateThresholdFromInput();
    }
    if (parsed.actions && state.labels.length) {
      state.labels.forEach((label) => {
        if (parsed.actions[label]) {
          state.actions[label] = { ...state.actions[label], ...parsed.actions[label] };
        }
      });
      renderActionCards();
      saveSettings();
    }
    showToast("설정을 불러왔습니다.");
  } catch {
    showToast("JSON 설정 파일을 읽지 못했습니다.", "error");
  } finally {
    els.importSettingsInput.value = "";
  }
}

function resetSettings() {
  if (!state.modelBaseUrl) {
    showToast("초기화할 모델 설정이 없습니다.", "error");
    return;
  }
  localStorage.removeItem(`${STORAGE_KEYS.settingsPrefix}${state.modelBaseUrl}`);
  state.labels.forEach((label) => {
    state.actions[label] = {
      enabled: true,
      outputType: "text",
      text: `${label} 라벨이 인식되었습니다.`,
      imageUrl: "",
      imageDataUrl: "",
    };
  });
  renderActionCards();
  clearOutput();
  showToast("현재 모델의 행동 설정을 초기화했습니다.");
}

async function startWebcam() {
  if (!state.model) {
    showToast("먼저 모델을 불러와 주세요.", "error");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    state.video = document.createElement("video");
    state.video.srcObject = state.stream;
    state.video.autoplay = true;
    state.video.muted = true;
    state.video.playsInline = true;
    await state.video.play();

    els.webcamPlaceholder.hidden = true;
    els.webcamBox.appendChild(state.video);
    els.webcamBox.classList.add("active");
    els.startWebcamBtn.disabled = true;
    els.stopWebcamBtn.disabled = false;
    state.running = true;
    state.stableLabel = "";
    state.stableCount = 0;
    state.lastExecutedLabel = "";
    state.animationId = requestAnimationFrame(predictLoop);
    showToast("웹캠을 시작했습니다.");
  } catch (error) {
    const msg = error?.name === "NotAllowedError"
      ? "카메라 권한이 필요합니다. 브라우저 주소창의 권한 설정을 확인해 주세요."
      : "웹캠을 시작하지 못했습니다.";
    showToast(msg, "error");
  }
}

function stopWebcam() {
  if (state.animationId) cancelAnimationFrame(state.animationId);
  state.animationId = null;
  state.running = false;
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  if (state.video) {
    state.video.remove();
    state.video = null;
  }
  els.webcamPlaceholder.hidden = false;
  els.webcamBox.classList.remove("active");
  els.startWebcamBtn.disabled = !state.model;
  els.stopWebcamBtn.disabled = true;
}

async function predictLoop() {
  if (!state.running || !state.video || !state.model) return;
  if (state.video.readyState >= 2) {
    try {
      const predictions = await state.model.predict(state.video);
      handlePredictions(predictions);
    } catch (error) {
      console.warn("prediction failed", error);
    }
  }
  state.animationId = requestAnimationFrame(predictLoop);
}

function handlePredictions(predictions) {
  const top = predictions.reduce((best, current) => (
    current.probability > best.probability ? current : best
  ), predictions[0]);

  renderPredictionBars(predictions, top.className);
  els.topResult.textContent = `${top.className} / ${(top.probability * 100).toFixed(1)}%`;

  if (top.probability < state.threshold) {
    els.topResult.textContent += " - 확실하지 않음";
    state.stableLabel = "";
    state.stableCount = 0;
    return;
  }

  if (top.className === state.stableLabel) {
    state.stableCount += 1;
  } else {
    state.stableLabel = top.className;
    state.stableCount = 1;
  }

  if (state.stableCount >= 4 && state.lastExecutedLabel !== top.className) {
    state.lastExecutedLabel = top.className;
    executeAction(top.className);
  }
}

function renderPredictionBars(predictions, topLabel = "") {
  els.predictionBars.innerHTML = "";
  const source = predictions.length
    ? predictions
    : state.labels.map((label) => ({ className: label, probability: 0 }));

  source.forEach((prediction) => {
    const percent = Math.round(prediction.probability * 1000) / 10;
    const item = document.createElement("div");
    item.className = `prediction-item ${prediction.className === topLabel ? "top" : ""}`;
    item.innerHTML = `
      <div class="prediction-meta">
        <span></span>
        <strong>${percent.toFixed(1)}%</strong>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div>
    `;
    item.querySelector("span").textContent = prediction.className;
    els.predictionBars.appendChild(item);
  });
}

function executeAction(label) {
  const action = state.actions[label];
  if (!action || !action.enabled) {
    clearOutput(`${label} 라벨은 행동 사용이 꺼져 있습니다.`);
    return;
  }

  const usesText = action.outputType === "text" || action.outputType === "both";
  const usesImage = action.outputType === "image" || action.outputType === "both";
  const src = action.imageDataUrl || action.imageUrl;

  els.outputPlaceholder.hidden = true;
  els.outputMessage.hidden = !usesText;
  els.outputImage.hidden = !usesImage || !src;

  if (usesText) {
    els.outputMessage.textContent = action.text || `${label} 라벨이 인식되었습니다.`;
  }
  if (usesImage && src) {
    els.outputImage.src = src;
  }
  if (usesImage && !src && !usesText) {
    els.outputMessage.hidden = false;
    els.outputMessage.textContent = "이미지 URL이나 파일을 설정해 주세요.";
  }

  els.outputBox?.classList?.remove("pop");
  requestAnimationFrame(() => els.outputBox?.classList?.add("pop"));
}

function clearOutput(message = "행동이 실행되면 결과가 여기에 나타납니다.") {
  els.outputPlaceholder.hidden = false;
  els.outputPlaceholder.textContent = message;
  els.outputMessage.hidden = true;
  els.outputMessage.textContent = "";
  els.outputImage.hidden = true;
  els.outputImage.removeAttribute("src");
  els.topResult.textContent = "아직 예측 결과가 없습니다.";
}

function updateThresholdFromInput() {
  const value = Number(els.thresholdInput.value);
  state.threshold = value / 100;
  els.thresholdValue.textContent = `${value}%`;
  saveSettings();
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.", "error");
  }
}

function openConfiguredUrl(key) {
  const url = CONFIG[key];
  if (!url) {
    showToast("아직 링크가 설정되지 않았습니다. CONFIG에서 주소를 입력해 주세요.", "error");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function bindEvents() {
  els.menuToggle.addEventListener("click", () => {
    const expanded = els.menuToggle.getAttribute("aria-expanded") === "true";
    els.menuToggle.setAttribute("aria-expanded", String(!expanded));
    els.navMenu.classList.toggle("open", !expanded);
  });

  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`#${button.dataset.scrollTarget}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      els.navMenu.classList.remove("open");
      els.menuToggle.setAttribute("aria-expanded", "false");
    });
  });

  document.querySelectorAll("[data-open-url]").forEach((button) => {
    button.addEventListener("click", () => openConfiguredUrl(button.dataset.openUrl));
  });

  els.loadModelBtn.addEventListener("click", loadModel);
  els.modelUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadModel();
  });
  els.useSampleBtn.addEventListener("click", () => {
    els.modelUrlInput.value = CONFIG.SAMPLE_MODEL_URL;
    showToast("예시 모델 링크를 넣었습니다.");
  });
  els.copyModelUrlBtn.addEventListener("click", () => {
    const url = state.modelBaseUrl || els.modelUrlInput.value.trim();
    if (!url) {
      showToast("복사할 모델 링크가 없습니다.", "error");
      return;
    }
    copyText(url, "모델 링크를 복사했습니다.");
  });
  els.thresholdInput.addEventListener("input", updateThresholdFromInput);
  els.exportSettingsBtn.addEventListener("click", exportSettings);
  els.importSettingsInput.addEventListener("change", (event) => importSettings(event.target.files?.[0]));
  els.resetSettingsBtn.addEventListener("click", resetSettings);
  els.startWebcamBtn.addEventListener("click", startWebcam);
  els.stopWebcamBtn.addEventListener("click", stopWebcam);
}

function init() {
  bindEvents();
  const savedUrl = localStorage.getItem(STORAGE_KEYS.modelUrl);
  els.modelUrlInput.value = savedUrl && savedUrl !== CONFIG.SAMPLE_MODEL_URL ? savedUrl : "";
  els.thresholdInput.value = Math.round(CONFIG.DEFAULT_CONFIDENCE_THRESHOLD * 100);
  updateThresholdFromInput();
  waitForTmImage()
    .then(() => setStatus("준비 완료. 모델 링크를 입력해 주세요.", "info"))
    .catch((error) => setStatus(error.message, "error"));
}

window.addEventListener("beforeunload", stopWebcam);
window.addEventListener("DOMContentLoaded", init);
