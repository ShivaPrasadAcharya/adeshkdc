(function () {
  "use strict";
  if (window.CauseListRealtimeSync) return;
  if (window.self !== window.top) return;
  const firebaseConfig = {
    apiKey: "AIzaSyAcyq9hsO8Z4ILYMZSvnU95XW3dzVSGG7M",
    authDomain: "sync-cba.firebaseapp.com",
    databaseURL:
      "https://sync-cba-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "sync-cba",
    storageBucket: "sync-cba.firebasestorage.app",
    messagingSenderId: "577607796039",
    appId: "1:577607796039:web:5d08abf38bd6d69dffb862",
    measurementId: "G-8284K2WJSS",
  };
  const SDK_VERSION = "10.12.2",
    ROOM_STORAGE = "cause-list-firebase-room-v1",
    DEVICE_STORAGE = "cause-list-firebase-device-v1",
    NAME_STORAGE = "cause-list-firebase-name-v1",
    MAX_CONNECTORS = 3,
    PRESENCE_STALE_MS = 2 * 60 * 1000,
    CHAT_RETENTION_MS = 9 * 60 * 60 * 1000,
    CHAT_FILE_MAX_BYTES = 5 * 1024 * 1024,
    CHAT_THEME_STORAGE = "cause-list-chat-theme-v1",
    POSITION_STORAGE_PREFIX = "cause-list-preview-position-v1:";
  const pageId = safeSegment(
    (location.pathname.split("/").pop() || "index.html").replace(
      /\.html?$/i,
      "",
    ) || "index",
  );
  let adapter = null,
    roomCode = "",
    basePath = "",
    applyingRemote = false,
    fieldsInitialized = false,
    previewInitialized = false;
  let coreUnsubs = [],
    draftUnsub = null,
    currentDraftKey = "",
    currentDraftHash = "",
    draftInitialized = false,
    localDraftEditedAt = 0,
    draftLastEditedAt = 0;
  let connectedUserName = "",
    presenceSlot = "",
    presenceDisconnectCancel = null,
    presenceHeartbeat = null,
    chatCleanupTimer = null,
    submissionsCache = [],
    chatCache = {},
    chatInitialized = false,
    seenChatIds = new Set(),
    visibleChatEntries = [],
    pendingChatAcks = new Set(),
    unreadChatCount = 0,
    activeCompareCaseKey = "",
    comparisonAnnotationSide = "original",
    comparisonAnchorSequence = 0;
  let pendingChatFile = null;
  const fieldTimers = new Map(),
    localFieldTimes = new Map(),
    pendingFields = new Map();
  const deviceId = getDeviceId();
  let root,
    launch,
    panel,
    statusText,
    nameInput,
    codeInput,
    roomDisplay,
    membersText,
    chatMessages,
    chatInput,
    chatSend,
    chatFileInput,
    chatFilePending,
    chatToastStack,
    compareBackdrop;
  function safeSegment(value) {
    return (
      String(value || "")
        .replace(/[.#$\[\]/]/g, "_")
        .replace(/[^\w\-\u0900-\u097f]/g, "_")
        .slice(0, 100) || "item"
    );
  }
  function hash(value) {
    let h = 2166136261;
    for (const ch of String(value || "")) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return "k" + (h >>> 0).toString(16);
  }
  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_STORAGE);
      if (!id) {
        id =
          "d" +
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 9);
        localStorage.setItem(DEVICE_STORAGE, id);
      }
      return id;
    } catch (error) {
      return "d" + Math.random().toString(36).slice(2, 11);
    }
  }
  function asciiDigits(value) {
    return String(value || "").replace(/[०-९]/g, (digit) =>
      String("०१२३४५६७८९".indexOf(digit)),
    );
  }
  function validCode(value) {
    const code = asciiDigits(value).replace(/\D/g, "").slice(0, 3);
    return /^\d{3}$/.test(code) && Number(code) >= 100 ? code : "";
  }
  function cleanUserName(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  }
  function safeFilePart(value) {
    return (
      cleanUserName(value)
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "user"
    );
  }
  function timestampLabel(value) {
    const date = new Date(Number(value) || Date.now());
    try {
      return new Intl.DateTimeFormat("ne-NP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }
  function fileTimestamp(value) {
    return new Date(Number(value) || Date.now())
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z")
      .replace("T", "-");
  }
  function sanitizeStoredHtml(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");
    template.content
      .querySelectorAll("script,style,iframe,object,embed,link,meta,form")
      .forEach((element) => element.remove());
    template.content.querySelectorAll("*").forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        if (
          /^on/i.test(attribute.name) ||
          /^(?:src|href|formaction|srcdoc)$/i.test(attribute.name)
        )
          element.removeAttribute(attribute.name);
      });
    });
    return template.innerHTML.slice(0, 500000);
  }
  function escapeHtml(value) {
    return String(value || "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  }
  function setStatus(message, state = "local") {
    if (statusText) statusText.textContent = message;
    if (root) root.dataset.state = state;
    if (launch)
      launch.querySelector(".cfsync-label").textContent = roomCode
        ? "Sync " + roomCode
        : "Realtime Sync";
  }
  function injectUi() {
    if (document.getElementById("causeListFirebaseSync")) return;
    root = document.createElement("section");
    root.id = "causeListFirebaseSync";
    root.className = "cfsync";
    root.dataset.state = "local";
    root.dataset.connected = "0";
    root.dataset.chatTheme = readChatTheme();
    root.innerHTML = `
      <button type="button" class="cfsync-launch" aria-expanded="false">
        <span class="cfsync-dot" aria-hidden="true"></span><span class="cfsync-label">Realtime Sync</span><span class="cfsync-unread" hidden>०</span>
      </button>
      <div class="cfsync-panel" role="dialog" aria-label="Firebase realtime synchronization">
        <header class="cfsync-head"><strong>Realtime Sync & Chat</strong><button type="button" class="cfsync-close" aria-label="बन्द गर्नुहोस्">×</button></header>
        <div class="cfsync-body">
          <p class="cfsync-status">Sync बन्द छ। Local input यथावत् काम गर्छ।</p>
          <div class="cfsync-connect">
            <input class="cfsync-name" data-firebase-ignore maxlength="40" placeholder="प्रयोगकर्ताको नाम" aria-label="प्रयोगकर्ताको नाम">
            <div class="cfsync-fields"><input class="cfsync-code" data-firebase-ignore inputmode="numeric" maxlength="3" placeholder="•••" aria-label="३-अङ्कको sync code"><button type="button" class="cfsync-btn cfsync-primary cfsync-connect-btn">Connect</button></div>
            <div class="cfsync-actions"><button type="button" class="cfsync-btn cfsync-generate">नयाँ code</button><button type="button" class="cfsync-btn cfsync-use-last">पछिल्लो code</button></div>
          </div>
          <div class="cfsync-active">
            <div class="cfsync-room-line"><span>Active sync code</span><strong class="cfsync-room">---</strong></div>
            <p class="cfsync-members">Connectors: ०/${MAX_CONNECTORS}</p>
            <div class="cfsync-actions"><button type="button" class="cfsync-btn cfsync-copy">Code copy</button><button type="button" class="cfsync-btn cfsync-disconnect">Disconnect</button></div>
          </div>
          <section class="cfsync-chat" aria-label="Connector chat">
            <div class="cfsync-chat-title"><div><strong>Connector chat</strong><span>९ घण्टासम्म मात्र</span></div><div class="cfsync-chat-tools" role="group" aria-label="Chat appearance and notifications"><button type="button" class="cfsync-notify" aria-label="Browser notification सक्रिय गर्नुहोस्" title="Browser notification">🔔</button><button type="button" class="cfsync-theme" data-chat-theme="dark" aria-label="Dark chat mode" title="Dark mode">☾</button><button type="button" class="cfsync-theme" data-chat-theme="light" aria-label="Light chat mode" title="Light mode">☀</button></div></div>
            <div class="cfsync-chat-messages" aria-live="polite"><p class="cfsync-chat-empty">अझै कुनै सन्देश छैन।</p></div>
            <div class="cfsync-chat-file-pending" hidden><span class="cfsync-chat-file-name"></span><button type="button" class="cfsync-chat-file-clear" aria-label="छानिएको file हटाउनुहोस्" title="Remove attachment">×</button></div>
            <div class="cfsync-chat-compose"><input class="cfsync-chat-file-input" data-firebase-ignore type="file" hidden><button type="button" class="cfsync-chat-attach" aria-label="File attach गर्नुहोस्" title="Attach file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16.5 6.5v9a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v9.5a1.5 1.5 0 0 1-3 0V6h2v8.5a.5.5 0 0 0 1 0V5a2 2 0 0 0-4 0v10.5a2.5 2.5 0 0 0 5 0v-9h2z"/></svg></button><textarea class="cfsync-chat-input" data-firebase-ignore rows="1" maxlength="1000" placeholder="सन्देश लेख्नुहोस्…" aria-label="Chat message"></textarea><button type="button" class="cfsync-btn cfsync-primary cfsync-chat-send" aria-label="सन्देश पठाउनुहोस्" title="Send"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 3.5 22 12 3 20.5l2.1-7 10-1.5-10-1.5-2.1-7z"/></svg></button></div>
          </section>
          <p class="cfsync-note">एउटै passkey मा अधिकतम ३ connector मात्र जोडिन्छन्। Form, editable preview, submitted history र chat सोही connector समूहमा मात्र साझा हुन्छ।</p>
        </div>
      </div>`;
    document.body.appendChild(root);
    launch = root.querySelector(".cfsync-launch");
    panel = root.querySelector(".cfsync-panel");
    statusText = root.querySelector(".cfsync-status");
    nameInput = root.querySelector(".cfsync-name");
    codeInput = root.querySelector(".cfsync-code");
    roomDisplay = root.querySelector(".cfsync-room");
    membersText = root.querySelector(".cfsync-members");
    chatMessages = root.querySelector(".cfsync-chat-messages");
    chatInput = root.querySelector(".cfsync-chat-input");
    chatSend = root.querySelector(".cfsync-chat-send");
    chatFileInput = root.querySelector(".cfsync-chat-file-input");
    chatFilePending = root.querySelector(".cfsync-chat-file-pending");
    chatToastStack = document.createElement("div");
    chatToastStack.className = "cfsync-toast-stack";
    chatToastStack.setAttribute("aria-live", "assertive");
    document.body.appendChild(chatToastStack);
    setChatTheme(root.dataset.chatTheme);
    if ("Notification" in window && Notification.permission === "granted")
      root.querySelector(".cfsync-notify").dataset.enabled = "1";
    launch.addEventListener("click", () => {
      const open = !root.classList.contains("is-open");
      root.classList.toggle("is-open", open);
      launch.setAttribute("aria-expanded", String(open));
      if (open) {
        clearUnreadChat();
        scrollChatToBottom();
        markVisibleMessagesRead();
      }
      if (open && !roomCode) codeInput.focus();
    });
    root.querySelector(".cfsync-close").addEventListener("click", () => {
      root.classList.remove("is-open");
      launch.setAttribute("aria-expanded", "false");
    });
    codeInput.addEventListener("input", () => {
      codeInput.value = asciiDigits(codeInput.value)
        .replace(/\D/g, "")
        .slice(0, 3);
    });
    codeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        connectRoom(codeInput.value, false);
      }
    });
    root
      .querySelector(".cfsync-connect-btn")
      .addEventListener("click", () => connectRoom(codeInput.value, false));
    root
      .querySelector(".cfsync-generate")
      .addEventListener("click", () =>
        connectRoom(String(Math.floor(Math.random() * 900) + 100), true),
      );
    root.querySelector(".cfsync-use-last").addEventListener("click", () => {
      let code = "";
      try {
        code = localStorage.getItem(ROOM_STORAGE) || "";
      } catch (error) {}
      if (code) {
        codeInput.value = code;
        connectRoom(code, false);
      } else setStatus("पहिले प्रयोग गरिएको code भेटिएन।", "error");
    });
    root.querySelector(".cfsync-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(roomCode);
        setStatus("Code copy भयो—sync सक्रिय छ।", "online");
      } catch (error) {
        setStatus(
          "Code copy गर्न सकिएन; code म्यानुअल रूपमा टिप्नुहोस्।",
          "error",
        );
      }
    });
    root
      .querySelector(".cfsync-disconnect")
      .addEventListener("click", () => disconnectRoom(true));
    root.querySelectorAll("[data-chat-theme]").forEach((button) => {
      button.addEventListener("click", () =>
        setChatTheme(button.dataset.chatTheme, true),
      );
    });
    root
      .querySelector(".cfsync-notify")
      .addEventListener("click", requestBrowserNotifications);
    chatSend.addEventListener("click", sendChatMessage);
    root.querySelector(".cfsync-chat-attach").addEventListener("click", () =>
      chatFileInput.click(),
    );
    chatFileInput.addEventListener("change", selectChatFile);
    root
      .querySelector(".cfsync-chat-file-clear")
      .addEventListener("click", clearPendingChatFile);
    chatInput.addEventListener("input", autoSizeChatInput);
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) markVisibleMessagesRead();
    });
  }
  function readChatTheme() {
    try {
      return localStorage.getItem(CHAT_THEME_STORAGE) === "light"
        ? "light"
        : "dark";
    } catch (error) {
      return "dark";
    }
  }
  function setChatTheme(theme, persist = false) {
    const selected = theme === "light" ? "light" : "dark";
    if (root) root.dataset.chatTheme = selected;
    if (root)
      root.querySelectorAll("[data-chat-theme]").forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.chatTheme === selected),
        );
      });
    if (persist)
      try {
        localStorage.setItem(CHAT_THEME_STORAGE, selected);
      } catch (error) {}
  }
  async function requestBrowserNotifications() {
    if (!("Notification" in window)) {
      setStatus("यो browser मा system notification उपलब्ध छैन।", "error");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      const button = root && root.querySelector(".cfsync-notify");
      if (button) button.dataset.enabled = permission === "granted" ? "1" : "0";
      setStatus(
        permission === "granted"
          ? "नयाँ connector message को browser notification सक्रिय भयो।"
          : "Browser notification अनुमति दिइएन; in-page notification भने सक्रिय छ।",
        permission === "granted" ? "online" : "error",
      );
    } catch (error) {
      setStatus("Browser notification सक्रिय गर्न सकिएन।", "error");
    }
  }
  function clearUnreadChat() {
    unreadChatCount = 0;
    const badge = launch && launch.querySelector(".cfsync-unread");
    if (badge) {
      badge.hidden = true;
      badge.textContent = "०";
    }
  }
  function updateUnreadChat() {
    const badge = launch && launch.querySelector(".cfsync-unread");
    if (!badge) return;
    badge.textContent = nepaliDigits(Math.min(unreadChatCount, 99));
    badge.hidden = unreadChatCount < 1;
  }
  function openChatPanel() {
    if (!root || !launch) return;
    root.classList.add("is-open");
    launch.setAttribute("aria-expanded", "true");
    clearUnreadChat();
    scrollChatToBottom(true);
    markVisibleMessagesRead();
    if (chatInput) chatInput.focus();
  }
  function notifyIncomingChat(item) {
    const sender = cleanUserName(item.senderName) || "Connector",
      attachment = chatAttachment(item),
      message =
        String(item.text || "").slice(0, 180) ||
        (attachment ? "📎 " + attachment.name : "नयाँ सन्देश");
    if (!root.classList.contains("is-open")) {
      unreadChatCount += 1;
      updateUnreadChat();
    }
    if (chatToastStack) {
      const toast = document.createElement("button"),
        strong = document.createElement("strong"),
        text = document.createElement("span");
      toast.type = "button";
      toast.className = "cfsync-toast";
      strong.textContent = "नयाँ सन्देश · " + sender;
      text.textContent = message;
      toast.append(strong, text);
      toast.addEventListener("click", () => {
        openChatPanel();
        toast.remove();
      });
      chatToastStack.appendChild(toast);
      setTimeout(() => toast.remove(), 6500);
    }
    if (
      "Notification" in window &&
      Notification.permission === "granted" &&
      (document.hidden || !root.classList.contains("is-open"))
    ) {
      try {
        const notification = new Notification(sender + " · Connector chat", {
          body: message,
          tag: "cause-list-chat-" + roomCode,
        });
        notification.onclick = () => {
          window.focus();
          openChatPanel();
          notification.close();
        };
      } catch (error) {}
    }
  }
  async function createFirebaseAdapter() {
    if (window.__CAUSE_LIST_FIREBASE_ADAPTER__)
      return window.__CAUSE_LIST_FIREBASE_ADAPTER__;
    try {
      const appSdk = await import(
        "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/firebase-app.js"
      );
      const dbSdk = await import(
        "https://www.gstatic.com/firebasejs/" +
          SDK_VERSION +
          "/firebase-database.js"
      );
      const existing = appSdk
        .getApps()
        .find(
          (item) =>
            item.options && item.options.projectId === firebaseConfig.projectId,
        );
      const app =
        existing || appSdk.initializeApp(firebaseConfig, "cause-list-sync");
      const database = dbSdk.getDatabase(app);
      return {
        set(path, value) {
          return dbSdk.set(dbSdk.ref(database, path), value);
        },
        update(path, value) {
          return dbSdk.update(dbSdk.ref(database, path), value);
        },
        remove(path) {
          return dbSdk.remove(dbSdk.ref(database, path));
        },
        push(path, value) {
          return dbSdk.push(dbSdk.ref(database, path), value);
        },
        async transaction(path, updater) {
          const result = await dbSdk.runTransaction(
            dbSdk.ref(database, path),
            updater,
            { applyLocally: false },
          );
          return { committed: result.committed, value: result.snapshot.val() };
        },
        async onDisconnectRemove(path) {
          const operation = dbSdk.onDisconnect(dbSdk.ref(database, path));
          await operation.remove();
          return () => operation.cancel();
        },
        subscribe(path, onValue, onError) {
          return dbSdk.onValue(
            dbSdk.ref(database, path),
            (snapshot) => onValue(snapshot.val()),
            onError,
          );
        },
      };
    } catch (error) {
      console.error("Firebase sync init failed", error);
      return null;
    }
  }
  async function claimPresence() {
    const now = Date.now();
    for (let index = 1; index <= MAX_CONNECTORS; index += 1) {
      const slotPath = basePath + "/connectorSlots/" + index;
      const result = await adapter.transaction(slotPath, (current) => {
        const stale =
          current &&
          now - Number(current.lastSeen || current.joinedAt || 0) >
            PRESENCE_STALE_MS;
        if (!current || current.deviceId === deviceId || stale)
          return {
            deviceId: deviceId,
            userName: connectedUserName,
            joinedAt:
              current && current.deviceId === deviceId
                ? Number(current.joinedAt || now)
                : now,
            lastSeen: now,
          };
        return undefined;
      });
      if (
        result.committed &&
        result.value &&
        result.value.deviceId === deviceId
      ) {
        presenceSlot = slotPath;
        try {
          presenceDisconnectCancel = await adapter.onDisconnectRemove(slotPath);
        } catch (error) {
          console.warn("onDisconnect presence cleanup unavailable", error);
        }
        clearInterval(presenceHeartbeat);
        presenceHeartbeat = setInterval(refreshPresence, 30000);
        return true;
      }
    }
    return false;
  }
  async function refreshPresence() {
    if (!presenceSlot || !adapter || !roomCode) return;
    try {
      const result = await adapter.transaction(presenceSlot, (current) => {
        if (!current || current.deviceId !== deviceId) return undefined;
        return Object.assign({}, current, {
          userName: connectedUserName,
          lastSeen: Date.now(),
        });
      });
      if (!result.committed) {
        presenceSlot = "";
        setStatus(
          "Connector slot समाप्त भयो; पुनः connect गर्नुहोस्।",
          "error",
        );
        await disconnectRoom(false);
      }
    } catch (error) {
      console.warn("Presence heartbeat failed", error);
    }
  }
  async function releasePresence() {
    clearInterval(presenceHeartbeat);
    presenceHeartbeat = null;
    if (presenceDisconnectCancel) {
      try {
        await presenceDisconnectCancel();
      } catch (error) {}
      presenceDisconnectCancel = null;
    }
    const slotPath = presenceSlot;
    presenceSlot = "";
    if (!slotPath || !adapter) return;
    try {
      await adapter.transaction(slotPath, (current) =>
        current && current.deviceId === deviceId ? null : undefined,
      );
    } catch (error) {
      console.warn("Presence release failed", error);
    }
  }
  function stopSubscriptions() {
    coreUnsubs.forEach((unsub) => {
      try {
        unsub && unsub();
      } catch (error) {}
    });
    coreUnsubs = [];
    if (draftUnsub) {
      try {
        draftUnsub();
      } catch (error) {}
      draftUnsub = null;
    }
    clearInterval(chatCleanupTimer);
    chatCleanupTimer = null;
    clearUnreadChat();
    if (chatToastStack) chatToastStack.replaceChildren();
    applySubmissions({});
    if (membersText)
      membersText.textContent = "Connectors: ०/" + MAX_CONNECTORS;
    renderChat({});
    chatInitialized = false;
    seenChatIds.clear();
    visibleChatEntries = [];
    pendingChatAcks.clear();
  }
  async function connectRoom(rawCode, asHost = false, options = {}) {
    const code = validCode(rawCode);
    if (!code) {
      setStatus("मान्य ३-अङ्कको code (100–999) राख्नुहोस्।", "error");
      return false;
    }
    const requestedName = cleanUserName(
      (nameInput && nameInput.value) || connectedUserName,
    );
    if (!requestedName) {
      setStatus("पहिले प्रयोगकर्ताको नाम लेख्नुहोस्।", "error");
      if (nameInput) nameInput.focus();
      return false;
    }
    await releasePresence();
    stopSubscriptions();
    connectedUserName = requestedName;
    roomCode = code;
    basePath = "rooms/" + code + "/causeListV1";
    fieldsInitialized = false;
    previewInitialized = false;
    draftInitialized = false;
    root.dataset.connected = "0";
    roomDisplay.textContent = code;
    setStatus("Firebase सँग जोडिँदैछ…", "connecting");
    adapter = adapter || (await createFirebaseAdapter());
    if (!adapter) {
      roomCode = "";
      basePath = "";
      setStatus("Firebase उपलब्ध भएन। Local/offline mode यथावत् छ।", "error");
      return false;
    }
    try {
      if (asHost)
        await adapter.set(basePath + "/meta", {
          schema: 2,
          createdAt: Date.now(),
          createdBy: deviceId,
        });
      const admitted = await claimPresence();
      if (!admitted) {
        roomCode = "";
        basePath = "";
        root.dataset.connected = "0";
        setStatus("यो passkey मा ३ connector पहिले नै सक्रिय छन्।", "error");
        return false;
      }
      startCoreSubscriptions();
      if (currentDraftKey) startDraftSubscription();
      try {
        localStorage.setItem(ROOM_STORAGE, code);
        localStorage.setItem(NAME_STORAGE, connectedUserName);
      } catch (error) {}
      root.dataset.connected = "1";
      roomDisplay.textContent = code;
      setStatus(
        "Connected—" +
          connectedUserName +
          " का inputs, preview, history र chat sync छन्।",
        "online",
      );
      if (asHost) {
        await captureAllFields();
        await captureMainPreview();
        await captureDraft();
      }
      if (!options.silent) {
        root.classList.add("is-open");
        scrollChatToBottom();
        markVisibleMessagesRead();
      }
      document.dispatchEvent(
        new CustomEvent("cause-list:sync-connected", {
          detail: { code: code },
        }),
      );
      return true;
    } catch (error) {
      console.error("Firebase room connection failed", error);
      stopSubscriptions();
      await releasePresence();
      roomCode = "";
      basePath = "";
      root.dataset.connected = "0";
      setStatus(
        "Sync अनुमति वा network समस्या भयो। Firebase Database rules जाँच्नुहोस्।",
        "error",
      );
      return false;
    }
  }
  async function disconnectRoom(forget = false) {
    await releasePresence();
    stopSubscriptions();
    roomCode = "";
    basePath = "";
    root.dataset.connected = "0";
    roomDisplay.textContent = "---";
    codeInput.value = "";
    if (forget)
      try {
        localStorage.removeItem(ROOM_STORAGE);
      } catch (error) {}
    setStatus("Sync बन्द छ। Local input यथावत् काम गर्छ।", "local");
    document.dispatchEvent(new CustomEvent("cause-list:sync-disconnected"));
  }
  function startCoreSubscriptions() {
    coreUnsubs.push(
      adapter.subscribe(
        basePath + "/pages/" + pageId + "/fields",
        applyFields,
        (error) => syncError("Input sync पढ्न सकिएन।", error),
      ),
    );
    coreUnsubs.push(
      adapter.subscribe(
        basePath + "/pages/" + pageId + "/preview",
        applyPreview,
        (error) => syncError("Preview sync पढ्न सकिएन।", error),
      ),
    );
    coreUnsubs.push(
      adapter.subscribe(basePath + "/connectorSlots", renderMembers, (error) =>
        syncError("Connector list पढ्न सकिएन।", error),
      ),
    );
    coreUnsubs.push(
      adapter.subscribe(basePath + "/chat/messages", renderChat, (error) =>
        syncError("Chat पढ्न सकिएन।", error),
      ),
    );
    coreUnsubs.push(
      adapter.subscribe(basePath + "/submissions", applySubmissions, (error) =>
        syncError("Submitted history पढ्न सकिएन।", error),
      ),
    );
    clearInterval(chatCleanupTimer);
    chatCleanupTimer = setInterval(cleanupExpiredChat, 5 * 60 * 1000);
  }
  function nepaliDigits(value) {
    return String(value).replace(/\d/g, (digit) => "०१२३४५६७८९"[Number(digit)]);
  }
  function renderMembers(slots) {
    const now = Date.now();
    const members = Object.values(slots || {})
      .filter(
        (item) =>
          item &&
          item.deviceId &&
          now - Number(item.lastSeen || item.joinedAt || 0) <=
            PRESENCE_STALE_MS,
      )
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.deviceId === item.deviceId) ===
          index,
      );
    if (membersText) {
      const names = members
        .map((item) => cleanUserName(item.userName))
        .filter(Boolean)
        .join(", ");
      membersText.textContent =
        "Connectors: " +
        nepaliDigits(members.length) +
        "/" +
        nepaliDigits(MAX_CONNECTORS) +
        (names ? " · " + names : "");
    }
  }
  function autoSizeChatInput() {
    if (!chatInput) return;
    chatInput.style.height = "auto";
    chatInput.style.height =
      Math.min(Math.max(Number(chatInput.scrollHeight || 0), 40), 116) + "px";
  }
  function scrollChatToBottom(smooth = false) {
    if (!chatMessages) return;
    requestAnimationFrame(() => {
      const top = Number(chatMessages.scrollHeight || 0);
      if (typeof chatMessages.scrollTo === "function")
        try {
          chatMessages.scrollTo({
            top: top,
            behavior: smooth ? "smooth" : "auto",
          });
        } catch (error) {}
      chatMessages.scrollTop = top;
    });
  }
  function chatAcknowledgementMap(item, kind) {
    const value = item && item[kind];
    return value && typeof value === "object" ? value : {};
  }
  function acknowledgeChatMessage(item, kind) {
    if (
      !item ||
      !item.key ||
      item.senderId === deviceId ||
      !roomCode ||
      !adapter
    )
      return;
    const receiverKey = safeSegment(deviceId),
      acknowledgements = chatAcknowledgementMap(item, kind),
      pendingKey = item.key + ":" + kind;
    if (acknowledgements[receiverKey] || pendingChatAcks.has(pendingKey))
      return;
    pendingChatAcks.add(pendingKey);
    adapter
      .set(
        basePath +
          "/chat/messages/" +
          safeSegment(item.key) +
          "/" +
          kind +
          "/" +
          receiverKey,
        Date.now(),
      )
      .catch((error) =>
        console.warn("Chat acknowledgement सुरक्षित भएन", error),
      )
      .finally(() => pendingChatAcks.delete(pendingKey));
  }
  function chatIsVisible() {
    return (
      root &&
      root.classList.contains("is-open") &&
      root.dataset.connected === "1" &&
      !document.hidden
    );
  }
  function markVisibleMessagesRead() {
    if (!chatIsVisible()) return;
    visibleChatEntries.forEach((item) => {
      if (item.senderId !== deviceId) {
        acknowledgeChatMessage(item, "deliveredBy");
        acknowledgeChatMessage(item, "readBy");
      }
    });
  }
  function messageReceiptStatus(item) {
    const delivered = Object.keys(
        chatAcknowledgementMap(item, "deliveredBy"),
      ).some((id) => id !== safeSegment(deviceId)),
      read = Object.keys(chatAcknowledgementMap(item, "readBy")).some(
        (id) => id !== safeSegment(deviceId),
      );
    return read
      ? { mark: "✓✓", label: "पढियो" }
      : delivered
        ? { mark: "✓", label: "Receiver लाई पुग्यो" }
        : { mark: "", label: "पठाइँदै" };
  }
  function chatAttachment(item) {
    const file = item && item.file;
    if (!file || typeof file !== "object") return null;
    const name = String(file.name || "");
    const data = String(file.data || "");
    if (!name || !/^data:[^,]*;base64,/i.test(data)) return null;
    return {
      name: name,
      type: String(file.type || "application/octet-stream"),
      size: Math.max(0, Number(file.size || 0)),
      data: data,
    };
  }
  function formatFileSize(bytes) {
    const size = Math.max(0, Number(bytes || 0));
    if (size < 1024) return nepaliDigits(size) + " B";
    if (size < 1024 * 1024)
      return nepaliDigits((size / 1024).toFixed(1)) + " KB";
    return nepaliDigits((size / (1024 * 1024)).toFixed(1)) + " MB";
  }
  function downloadChatAttachment(file) {
    const attachment = chatAttachment({ file: file });
    if (!attachment) return;
    const anchor = document.createElement("a");
    anchor.href = attachment.data;
    anchor.download = attachment.name;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  function renderChat(messages) {
    chatCache = messages && typeof messages === "object" ? messages : {};
    if (!chatMessages) return;
    const cutoff = Date.now() - CHAT_RETENTION_MS;
    const entries = Object.entries(chatCache)
      .map(([key, value]) => Object.assign({ key: key }, value || {}))
      .filter(
        (item) =>
          (String(item.text || "").trim() || chatAttachment(item)) &&
          Number(item.timestamp || 0) >= cutoff,
      )
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    visibleChatEntries = entries.slice(-200);
    if (!chatInitialized) {
      entries.forEach((item) => seenChatIds.add(item.key));
      chatInitialized = true;
    } else {
      entries.forEach((item) => {
        if (!seenChatIds.has(item.key) && item.senderId !== deviceId)
          notifyIncomingChat(item);
        seenChatIds.add(item.key);
      });
    }
    visibleChatEntries.forEach((item) => {
      if (item.senderId !== deviceId)
        acknowledgeChatMessage(item, "deliveredBy");
    });
    chatMessages.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "cfsync-chat-empty";
      empty.textContent = "अझै कुनै सन्देश छैन।";
      chatMessages.appendChild(empty);
      return;
    }
    visibleChatEntries.forEach((item) => {
      const article = document.createElement("article");
      article.className =
        "cfsync-message" + (item.senderId === deviceId ? " is-own" : "");
      article.dataset.messageId = item.key;
      const meta = document.createElement("div");
      meta.className = "cfsync-message-meta";
      const sender = document.createElement("strong");
      sender.textContent = cleanUserName(item.senderName) || "Connector";
      const time = document.createElement("time");
      time.dateTime = new Date(Number(item.timestamp || 0)).toISOString();
      time.textContent = timestampLabel(item.timestamp);
      const trail = document.createElement("span");
      trail.className = "cfsync-message-trail";
      trail.appendChild(time);
      if (item.senderId === deviceId) {
        const receipt = messageReceiptStatus(item),
          status = document.createElement("span");
        status.className = "cfsync-message-receipt";
        if (receipt.mark === "✓✓") status.classList.add("is-read");
        status.textContent = receipt.mark;
        status.title = receipt.label;
        status.setAttribute("aria-label", receipt.label);
        trail.appendChild(status);
      }
      meta.append(sender, trail);
      article.appendChild(meta);
      if (String(item.text || "").trim()) {
        const body = document.createElement("p");
        body.textContent = String(item.text || "").slice(0, 1000);
        article.appendChild(body);
      }
      const attachment = chatAttachment(item);
      if (attachment) {
        const fileButton = document.createElement("button"),
          icon = document.createElement("span"),
          details = document.createElement("span"),
          fileName = document.createElement("strong"),
          fileMeta = document.createElement("small");
        fileButton.type = "button";
        fileButton.className = "cfsync-message-file";
        fileButton.title = attachment.name + " download गर्नुहोस्";
        fileButton.setAttribute(
          "aria-label",
          attachment.name + " download गर्नुहोस्",
        );
        icon.className = "cfsync-message-file-icon";
        icon.textContent = "↓";
        details.className = "cfsync-message-file-details";
        fileName.textContent = attachment.name;
        fileMeta.textContent = formatFileSize(attachment.size);
        details.append(fileName, fileMeta);
        fileButton.append(icon, details);
        fileButton.addEventListener("click", () =>
          downloadChatAttachment(attachment),
        );
        article.appendChild(fileButton);
      }
      chatMessages.appendChild(article);
    });
    scrollChatToBottom();
    markVisibleMessagesRead();
    cleanupExpiredChat();
  }
  async function cleanupExpiredChat() {
    if (!roomCode || !adapter) return;
    const cutoff = Date.now() - CHAT_RETENTION_MS;
    const updates = {};
    Object.entries(chatCache || {}).forEach(([key, item]) => {
      if (!item || Number(item.timestamp || 0) < cutoff) updates[key] = null;
    });
    if (Object.keys(updates).length)
      try {
        await adapter.update(basePath + "/chat/messages", updates);
      } catch (error) {
        console.warn("Expired chat cleanup failed", error);
      }
  }
  async function sendChatMessage() {
    if (!roomCode || !adapter || !presenceSlot) {
      setStatus("Chat गर्न पहिले passkey मा connect गर्नुहोस्।", "error");
      return;
    }
    const text = String((chatInput && chatInput.value) || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 1000);
    const file = pendingChatFile;
    if (!text && !file) {
      if (chatInput) chatInput.focus();
      return;
    }
    chatSend.disabled = true;
    try {
      const payload = {
        text: text,
        senderId: deviceId,
        senderName: connectedUserName,
        timestamp: Date.now(),
      };
      if (file)
        payload.file = {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          data: await readFileAsDataUrl(file),
        };
      await adapter.push(basePath + "/chat/messages", payload);
      chatInput.value = "";
      clearPendingChatFile();
      autoSizeChatInput();
      chatInput.focus();
    } catch (error) {
      syncError("Chat पठाउन सकिएन।", error);
    } finally {
      chatSend.disabled = false;
    }
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("File पढ्न सकिएन।"));
      reader.readAsDataURL(file);
    });
  }
  function clearPendingChatFile() {
    pendingChatFile = null;
    if (chatFileInput) chatFileInput.value = "";
    if (chatFilePending) {
      chatFilePending.hidden = true;
      const name = chatFilePending.querySelector(".cfsync-chat-file-name");
      if (name) name.textContent = "";
    }
  }
  function selectChatFile() {
    const file = chatFileInput && chatFileInput.files && chatFileInput.files[0];
    if (!file) {
      clearPendingChatFile();
      return;
    }
    if (file.size > CHAT_FILE_MAX_BYTES) {
      clearPendingChatFile();
      setStatus("Chat attachment अधिकतम ५ MB हुन सक्छ।", "error");
      return;
    }
    pendingChatFile = file;
    if (chatFilePending) {
      const name = chatFilePending.querySelector(".cfsync-chat-file-name");
      if (name) name.textContent = file.name + " · " + formatFileSize(file.size);
      chatFilePending.hidden = false;
    }
    setStatus("File attach भयो; send arrow थिच्नुहोस्।", "online");
  }
  function publicSubmission(item) {
    const copy = Object.assign({}, item);
    delete copy._relativePath;
    return copy;
  }
  function applySubmissions(users) {
    const items = [];
    function addItem(entry, id, ownerId, bucket, relativePath) {
      if (!entry || typeof entry !== "object") return;
      const lastEditedAt = Number(
          entry.lastEditedAt || entry.submittedAt || bucket.updatedAt || 0,
        ),
        item = Object.assign({}, entry, {
          id: entry.id || id,
          ownerId: entry.ownerId || ownerId,
          userName:
            cleanUserName(entry.userName || bucket.userName) || "Connector",
          caseKey: String(entry.caseKey || bucket.caseKey || ""),
          lastEditedAt: lastEditedAt,
          _relativePath: relativePath,
        });
      delete item.expiresAt;
      items.push(item);
    }
    Object.entries(users || {}).forEach(([ownerId, bucket]) => {
      if (!bucket || typeof bucket !== "object") return;
      Object.entries(bucket.entries || {}).forEach(([id, entry]) => {
        addItem(entry, id, ownerId, bucket, ownerId + "/entries/" + id);
      });
      Object.entries(bucket.cases || {}).forEach(([caseHash, caseBucket]) => {
        if (!caseBucket || typeof caseBucket !== "object") return;
        Object.entries(caseBucket.entries || {}).forEach(([id, entry]) => {
          addItem(
            entry,
            id,
            ownerId,
            caseBucket,
            ownerId + "/cases/" + caseHash + "/entries/" + id,
          );
        });
      });
    });
    submissionsCache = items.sort(
      (a, b) =>
        Number(b.lastEditedAt || b.submittedAt || 0) -
        Number(a.lastEditedAt || a.submittedAt || 0),
    );
    document.dispatchEvent(
      new CustomEvent("cause-list:submissions-updated", {
        detail: { items: submissionsCache.map(publicSubmission) },
      }),
    );
  }
  async function submitPreview(payload) {
    if (!roomCode || !adapter || !presenceSlot)
      throw new Error(
        "Realtime Sync मा connect गरेपछि मात्र SUBMIT गर्न सकिन्छ।",
      );
    const source = payload && typeof payload === "object" ? payload : {},
      submittedAt = Date.now(),
      caseKey = String(source.caseKey || "").slice(0, 180);
    if (!caseKey) throw new Error("यो आदेश/फैसलाको independent key भेटिएन।");
    const requestedEditedAt = Number(source.lastEditedAt || 0),
      lastEditedAt = requestedEditedAt
        ? Math.min(submittedAt, requestedEditedAt)
        : submittedAt,
      stem = safeFilePart(source.stem || source.caseNo || "preview"),
      id = "s" + submittedAt.toString(36) + "_" + hash(Math.random()),
      item = {
        id: id,
        ownerId: deviceId,
        userName: connectedUserName,
        submittedAt: submittedAt,
        lastEditedAt: lastEditedAt,
        fileName:
          safeFilePart(connectedUserName) +
          "-" +
          fileTimestamp(submittedAt) +
          "-" +
          stem +
          ".html",
        caseKey: caseKey,
        caseNo: String(source.caseNo || "").slice(0, 100),
        caseTitle: String(source.caseTitle || "").slice(0, 240),
        documentType: String(source.documentType || "आदेश").slice(0, 30),
        dateKey: String(source.dateKey || "")
          .replace(/\D/g, "")
          .slice(0, 8),
        draftHtml: sanitizeStoredHtml(source.draftHtml),
        plainText: String(source.plainText || "").slice(0, 500000),
      },
      bucketPath = basePath + "/submissions/" + safeSegment(deviceId);
    const result = await adapter.transaction(bucketPath, (current) => {
      const entries = Object.assign({}, (current && current.entries) || {});
      entries[id] = item;
      const latest = Object.values(entries)
        .filter(
          (entry) => entry && typeof entry === "object",
        )
        .sort(
          (a, b) =>
            Number(b.submittedAt || 0) - Number(a.submittedAt || 0),
        )
        .slice(0, 2);
      const kept = {};
      latest.forEach((entry) => {
        kept[entry.id] = entry;
      });
      return {
        ownerId: deviceId,
        userName: connectedUserName,
        updatedAt: submittedAt,
        entries: kept,
      };
    });
    if (!result.committed) throw new Error("Submitted history सुरक्षित भएन।");
    return item;
  }
  function syncError(message, error) {
    console.error(message, error);
    setStatus(message + " Database rules/network जाँच्नुहोस्।", "error");
  }
  function isSyncable(element) {
    if (
      !element ||
      !element.matches ||
      !element.matches("input,textarea,select")
    )
      return false;
    if (
      element.closest(
        "#causeListFirebaseSync,.cob-backdrop,.cfcompare-backdrop",
      ) ||
      element.hasAttribute("data-firebase-ignore")
    )
      return false;
    const type = (element.type || "").toLowerCase();
    return (
      !["file", "button", "submit", "reset", "image"].includes(type) &&
      !element.readOnly
    );
  }
  function fieldLocator(element) {
    if (element.id) return { kind: "id", value: element.id };
    if (element.name) {
      const matches = Array.from(
        document.querySelectorAll(
          '[name="' + String(element.name).replace(/"/g, '\\"') + '"]',
        ),
      ).filter(isSyncable);
      return {
        kind: "name",
        value: element.name,
        index: Math.max(0, matches.indexOf(element)),
        tag: element.tagName,
      };
    }
    const all = Array.from(
        document.querySelectorAll("input,textarea,select"),
      ).filter(isSyncable),
      index = Math.max(0, all.indexOf(element));
    return { kind: "ordinal", index: index, tag: element.tagName };
  }
  function fieldKey(locator) {
    return locator.kind === "id"
      ? "id_" + safeSegment(locator.value)
      : hash(pageId + JSON.stringify(locator));
  }
  function readField(element) {
    const locator = fieldLocator(element),
      type = (element.type || element.tagName).toLowerCase(),
      state = {
        locator: locator,
        type: type,
        updatedAt: Date.now(),
        updatedBy: deviceId,
      };
    if (type === "checkbox" || type === "radio")
      state.checked = !!element.checked;
    else if (element.multiple)
      state.value = Array.from(element.selectedOptions).map(
        (option) => option.value,
      );
    else state.value = element.value;
    return { key: fieldKey(locator), state: state };
  }
  function findField(locator) {
    if (!locator) return null;
    if (locator.kind === "id") return document.getElementById(locator.value);
    if (locator.kind === "name") {
      const nodes = Array.from(
        document.getElementsByName(locator.value),
      ).filter(isSyncable);
      return nodes[locator.index || 0] || null;
    }
    const nodes = Array.from(
      document.querySelectorAll("input,textarea,select"),
    ).filter(isSyncable);
    return nodes[locator.index || 0] || null;
  }
  function queueField(element) {
    if (!roomCode || applyingRemote || !isSyncable(element)) return;
    const item = readField(element);
    localFieldTimes.set(item.key, item.state.updatedAt);
    clearTimeout(fieldTimers.get(item.key));
    const delay =
      element.tagName === "SELECT" ||
      ["checkbox", "radio"].includes((element.type || "").toLowerCase())
        ? 20
        : 220;
    fieldTimers.set(
      item.key,
      setTimeout(
        () =>
          adapter
            .set(
              basePath + "/pages/" + pageId + "/fields/" + item.key,
              item.state,
            )
            .catch((error) => syncError("Input sync गर्न सकिएन।", error)),
        delay,
      ),
    );
  }
  async function captureAllFields() {
    if (!roomCode || !adapter) return;
    const states = {};
    document.querySelectorAll("input,textarea,select").forEach((element) => {
      if (!isSyncable(element)) return;
      const item = readField(element);
      states[item.key] = item.state;
      localFieldTimes.set(item.key, item.state.updatedAt);
    });
    await adapter.set(basePath + "/pages/" + pageId + "/fields", states);
  }
  function applyFields(states) {
    if (!states || typeof states !== "object") {
      fieldsInitialized = true;
      return;
    }
    Object.entries(states).forEach(([key, state]) => {
      if (!state || typeof state !== "object") return;
      if (fieldsInitialized && state.updatedBy === deviceId) return;
      if ((localFieldTimes.get(key) || 0) > Number(state.updatedAt || 0))
        return;
      const element = findField(state.locator);
      if (!element) {
        pendingFields.set(key, state);
        return;
      }
      applyField(element, state);
    });
    fieldsInitialized = true;
  }
  function applyField(element, state) {
    applyingRemote = true;
    try {
      const type = (element.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio")
        element.checked = !!state.checked;
      else if (element.multiple && Array.isArray(state.value))
        Array.from(element.options).forEach((option) => {
          option.selected = state.value.includes(option.value);
        });
      else if (typeof state.value === "string" && element.value !== state.value)
        element.value = state.value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      if (
        (element.tagName === "SELECT" ||
          type === "checkbox" ||
          type === "radio") &&
        element.id !== "causeRibbonDateSelect"
      )
        element.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      applyingRemote = false;
    }
  }
  function applyPendingFields() {
    pendingFields.forEach((state, key) => {
      const element = findField(state.locator);
      if (element) {
        pendingFields.delete(key);
        applyField(element, state);
      }
    });
  }
  function previewState() {
    const output = document.getElementById("sourceOutput");
    if (!output) return null;
    return {
      html: output.value || "",
      mode:
        document.getElementById("monthlyPreview") &&
        !document.getElementById("monthlyPreview").classList.contains("hidden")
          ? "monthly"
          : "single",
      stats: {
        inputSize: textOf("inputSizeStat"),
        retained: textOf("retainedCount"),
        removed: textOf("removedCount"),
        outputSize: textOf("outputSize"),
        date: textOf("causeListDateStat"),
      },
      updatedAt: Date.now(),
      updatedBy: deviceId,
    };
  }
  function textOf(id) {
    const element = document.getElementById(id);
    return element ? element.textContent : "";
  }
  async function captureMainPreview() {
    const state = previewState();
    if (state && roomCode && adapter)
      await adapter.set(basePath + "/pages/" + pageId + "/preview", state);
  }
  function applyPreview(state) {
    if (!state || typeof state !== "object") {
      previewInitialized = true;
      return;
    }
    if (previewInitialized && state.updatedBy === deviceId) return;
    applyingRemote = true;
    try {
      document.dispatchEvent(
        new CustomEvent("cause-list:preview-remote", { detail: state }),
      );
    } finally {
      applyingRemote = false;
    }
    previewInitialized = true;
  }
  function draftPath() {
    return currentDraftHash ? basePath + "/drafts/" + currentDraftHash : "";
  }
  function startDraftSubscription() {
    if (draftUnsub) {
      try {
        draftUnsub();
      } catch (error) {}
      draftUnsub = null;
    }
    if (!roomCode || !currentDraftKey) return;
    currentDraftHash = hash(currentDraftKey);
    draftInitialized = false;
    draftUnsub = adapter.subscribe(draftPath(), applyDraft, (error) =>
      syncError("Editable preview sync पढ्न सकिएन।", error),
    );
  }
  function readDraft() {
    const backdrop = document.querySelector(
      ".cob-backdrop.cob-open[data-cob-sync-key]",
    );
    if (!backdrop || backdrop.dataset.cobSyncKey !== currentDraftKey)
      return null;
    const draft = backdrop.querySelector("#cobDraft"),
      active = backdrop.querySelector(
        "[data-reverse-mode][data-active='1'],[data-reverse-mode][aria-pressed='true']",
      );
    return {
      keyHash: currentDraftHash || hash(currentDraftKey),
      documentType: (backdrop.querySelector("#cobType") || {}).value || "आदेश",
      partyStatus:
        (backdrop.querySelector("#cobPartyStatus") || {}).value ||
        "वादी|प्रतिवादी",
      reverseMode: active ? active.dataset.reverseMode : "none",
      draftHtml: draft ? draft.innerHTML : "",
      fontSize: draft ? Number(draft.dataset.cobFontSize || 13) : 13,
      updatedAt: draftLastEditedAt || Date.now(),
      updatedBy: deviceId,
    };
  }
  async function captureDraft() {
    const state = readDraft();
    if (state && roomCode && adapter)
      await adapter.set(
        draftPath() || basePath + "/drafts/" + state.keyHash,
        state,
      );
  }
  function queueDraft() {
    if (!roomCode || applyingRemote || !currentDraftKey) return;
    localDraftEditedAt = Date.now();
    draftLastEditedAt = localDraftEditedAt;
    clearTimeout(queueDraft.timer);
    queueDraft.timer = setTimeout(
      () =>
        captureDraft().catch((error) =>
          syncError("Editable preview sync गर्न सकिएन।", error),
        ),
      220,
    );
  }
  function applyDraft(state) {
    if (!state || typeof state !== "object") {
      draftInitialized = true;
      return;
    }
    if (draftInitialized && state.updatedBy === deviceId) return;
    if (localDraftEditedAt > Number(state.updatedAt || 0)) return;
    const backdrop = document.querySelector(
      ".cob-backdrop.cob-open[data-cob-sync-key]",
    );
    if (!backdrop || backdrop.dataset.cobSyncKey !== currentDraftKey) return;
    applyingRemote = true;
    draftLastEditedAt = Number(state.updatedAt || Date.now());
    try {
      const type = backdrop.querySelector("#cobType"),
        party = backdrop.querySelector("#cobPartyStatus"),
        draft = backdrop.querySelector("#cobDraft");
      if (type && state.documentType && type.value !== state.documentType) {
        type.value = state.documentType;
        type.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (party && state.partyStatus && party.value !== state.partyStatus) {
        party.value = state.partyStatus;
        party.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const mode = ["none", "partial", "full"].includes(state.reverseMode)
          ? state.reverseMode
          : "none",
        button = backdrop.querySelector('[data-reverse-mode="' + mode + '"]');
      if (button && button.getAttribute("aria-pressed") !== "true")
        button.click();
      if (
        draft &&
        typeof state.draftHtml === "string" &&
        draft.innerHTML !== state.draftHtml
      ) {
        draft.innerHTML = state.draftHtml;
        draft.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (draft && Number(state.fontSize)) {
        const fontSize = Math.max(9, Math.min(24, Number(state.fontSize))),
          slider = backdrop.querySelector("#cobFontSize"),
          output = backdrop.querySelector("#cobFontSizeValue");
        draft.dataset.cobFontSize = String(fontSize);
        draft.style.fontSize = fontSize + "pt";
        if (slider) slider.value = String(fontSize);
        if (output) {
          output.value = fontSize + " pt";
          output.textContent = fontSize + " pt";
        }
      }
    } finally {
      applyingRemote = false;
    }
    draftInitialized = true;
  }
  function positionStorageKey(key = currentDraftKey) {
    return key ? POSITION_STORAGE_PREFIX + hash(key) : "";
  }
  function readDraftPosition(key = currentDraftKey) {
    const storageKey = positionStorageKey(key);
    if (!storageKey) return null;
    try {
      const state = JSON.parse(localStorage.getItem(storageKey) || "null");
      return state && typeof state === "object" ? state : null;
    } catch (error) {
      return null;
    }
  }
  function caretOffsetWithin(element) {
    const selection = getSelection();
    if (
      !element ||
      !selection ||
      !selection.rangeCount ||
      !element.contains(selection.anchorNode)
    )
      return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(element);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().length;
  }
  function placeCaretAt(element, requestedOffset) {
    if (!element) return null;
    const targetOffset = Math.max(0, Number(requestedOffset || 0)),
      walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = targetOffset,
      node = walker.nextNode(),
      target = element,
      offset = 0;
    while (node) {
      if (remaining <= node.nodeValue.length) {
        target = node;
        offset = remaining;
        break;
      }
      remaining -= node.nodeValue.length;
      const next = walker.nextNode();
      if (!next) {
        target = node;
        offset = node.nodeValue.length;
      }
      node = next;
    }
    const range = document.createRange(),
      selection = getSelection();
    range.setStart(target, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
  }
  function rememberDraftPosition(edited = false) {
    if (!currentDraftKey) return;
    const backdrop = document.querySelector(
        ".cob-backdrop.cob-open[data-cob-sync-key]",
      ),
      draft = backdrop && backdrop.querySelector("#cobDraft"),
      modal = backdrop && backdrop.querySelector(".cob-modal"),
      previous = readDraftPosition() || {},
      caretOffset = caretOffsetWithin(draft),
      state = {
        caretOffset:
          caretOffset === null
            ? Number(previous.caretOffset || 0)
            : caretOffset,
        scrollTop: modal ? Number(modal.scrollTop || 0) : 0,
        editedAt: edited
          ? Date.now()
          : Number(previous.editedAt || draftLastEditedAt || 0),
        savedAt: Date.now(),
      };
    if (!backdrop || backdrop.dataset.cobSyncKey !== currentDraftKey) return;
    if (edited) draftLastEditedAt = state.editedAt;
    try {
      localStorage.setItem(positionStorageKey(), JSON.stringify(state));
    } catch (error) {}
  }
  function restoreDraftPosition(button) {
    const state = readDraftPosition(),
      backdrop = button.closest(".cob-backdrop"),
      draft = backdrop && backdrop.querySelector("#cobDraft"),
      modal = backdrop && backdrop.querySelector(".cob-modal");
    if (!state || !draft || !modal) {
      setStatus("यो preview को पछिल्लो स्थान सुरक्षित भएको छैन।", "error");
      return;
    }
    try {
      draft.focus({ preventScroll: true });
    } catch (error) {
      draft.focus();
    }
    const caretTarget = placeCaretAt(draft, state.caretOffset);
    modal.scrollTop = Number(state.scrollTop || 0);
    requestAnimationFrame(() => {
      if (caretTarget && typeof caretTarget.scrollIntoView === "function")
        caretTarget.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    button.classList.add("cob-confirmed");
    setTimeout(() => button.classList.remove("cob-confirmed"), 1600);
  }
  function goPreviewTop(button) {
    const backdrop = button.closest(".cob-backdrop"),
      modal = backdrop && backdrop.querySelector(".cob-modal");
    if (!modal) return;
    if (typeof modal.scrollTo === "function") {
      try {
        modal.scrollTo({ top: 0, behavior: "smooth" });
      } catch (error) {}
    }
    modal.scrollTop = 0;
    button.classList.add("cob-confirmed");
    setTimeout(() => button.classList.remove("cob-confirmed"), 1200);
  }
  function actionButton(label, className, icon) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cob-btn cob-icon-btn " + className;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">' +
      icon +
      '</svg><span class="cob-tooltip">' +
      label +
      "</span>";
    return button;
  }
  function injectSubmissionButtons() {
    if (!document || !document.querySelectorAll) return;
    document
      .querySelectorAll(".cob-backdrop .cob-actions")
      .forEach((actions) => {
        if (actions.dataset.sharedHistoryReady === "1") return;
        actions.dataset.sharedHistoryReady = "1";
        const submit = actionButton(
          "SUBMIT",
          "cfsubmit-button",
          '<path d="M3 3.5 22 12 3 20.5l2.2-7L15 12l-9.8-1.5L3 3.5zm3.7 8.1-.4 1.3-1.1 3.5 11.5-5.1-10-4.5 1.1 3.4 8.1 1.2-9.2.2z"/>',
        );
        const compare = actionButton(
          "COMPARE",
          "cfcompare-button",
          '<path d="M4 3h7v18H4V3zm9 0h7v18h-7V3zm-7 3v2h3V6H6zm9 8v2h3v-2h-3z"/>',
        );
        const goTop = actionButton(
          "Go to Top",
          "cfpreview-top",
          '<path d="M12 3 5 10h4v8h6v-8h4l-7-7zM5 20h14v2H5v-2z"/>',
        );
        const pickUp = actionButton(
          "Pick from where you left",
          "cfpreview-resume",
          '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/>',
        );
        submit.addEventListener("click", () => handleSubmit(submit));
        compare.addEventListener("click", () => openCompare(compare));
        goTop.addEventListener("click", () => goPreviewTop(goTop));
        pickUp.addEventListener("click", () => restoreDraftPosition(pickUp));
        const orderedActions = [
          pickUp,
          goTop,
          actions.querySelector("#cobTools"),
          actions.querySelector("#cobSave"),
          actions.querySelector("#cobCopy"),
          actions.querySelector("#cobTxt"),
          actions.querySelector("#cobDocx"),
          actions.querySelector("#cobPrint"),
          submit,
          compare,
        ].filter(Boolean);
        actions.append(...orderedActions);
      });
  }
  function currentPreviewPayload(button) {
    const backdrop = button.closest(".cob-backdrop");
    const draft = backdrop && backdrop.querySelector("#cobDraft");
    const plainText = String(
      (draft && (draft.innerText || draft.textContent)) || "",
    ).trim();
    if (!draft || !plainText)
      throw new Error("SUBMIT गर्न preview खाली हुनु हुँदैन।");
    const caseMatch = plainText.match(
      /(?:मुद्दा|निवेदन)\s*नम्बर\s*[-–—:]\s*([^\n]+)/,
    );
    const parties = Array.from(draft.querySelectorAll(".cob-party-name"))
      .map((element) => element.textContent.trim())
      .filter(Boolean);
    let dateKey = "";
    try {
      const config = JSON.parse(
        (document.getElementById("cause-list-config") || {}).textContent ||
          "{}",
      );
      dateKey = String(config.causeDateKey || "")
        .replace(/\D/g, "")
        .slice(0, 8);
    } catch (error) {}
    const caseKey = String(backdrop.dataset.cobSyncKey || "");
    return {
      caseKey: caseKey,
      caseNo: caseMatch ? caseMatch[1].trim() : "",
      caseTitle:
        parties.length >= 2 ? parties[0] + " विरुद्ध " + parties[1] : "",
      documentType: (backdrop.querySelector("#cobType") || {}).value || "आदेश",
      dateKey: dateKey,
      stem: caseKey.split(":").pop() || "preview",
      lastEditedAt:
        draftLastEditedAt ||
        Number((readDraftPosition(caseKey) || {}).editedAt || 0) ||
        Date.now(),
      draftHtml: draft.innerHTML,
      fontSize: Number(draft.dataset.cobFontSize || 13),
      plainText: plainText,
    };
  }
  async function handleSubmit(button) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const item = await submitPreview(currentPreviewPayload(button));
      button.classList.add("cob-confirmed");
      button.title = "Submitted: " + item.fileName;
      setStatus("SUBMIT सफल—shared history मा सुरक्षित भयो।", "online");
      setTimeout(() => {
        button.classList.remove("cob-confirmed");
        button.title = "SUBMIT";
      }, 1800);
    } catch (error) {
      const message =
        error && error.message ? error.message : "SUBMIT गर्न सकिएन।";
      setStatus(message, "error");
      alert(message);
    } finally {
      button.disabled = false;
    }
  }
  function ensureCompareUi() {
    if (compareBackdrop) return;
    compareBackdrop = document.createElement("div");
    compareBackdrop.className = "cfcompare-backdrop";
    compareBackdrop.innerHTML = `
      <section class="cfcompare-modal" role="dialog" aria-modal="true" aria-labelledby="cfcompareTitle">
        <header class="cfcompare-head"><div><h2 id="cfcompareTitle">Submitted files तुलना</h2><p>कुनै ठीक २ वटा file छान्नुहोस्।</p></div><button type="button" class="cfcompare-close" aria-label="बन्द गर्नुहोस्">×</button></header>
        <div class="cfcompare-body">
          <p class="cfcompare-notice" role="status" aria-live="polite"></p>
          <div class="cfcompare-result" hidden></div>
        </div>
        <div class="cfcompare-floating-tools">
          <div class="cfcompare-picker">
            <button type="button" class="cfcompare-fab cfcompare-picker-toggle" aria-expanded="false" aria-controls="cfcomparePickerMenu">☑ <span>Files</span></button>
            <section class="cfcompare-picker-menu" id="cfcomparePickerMenu" hidden><header><strong>Comparison files</strong><small>ठीक २ वटा छान्नुहोस्</small></header><div class="cfcompare-list" aria-label="Submitted history"></div><footer><strong class="cfcompare-count">०/२ छनोट</strong><button type="button" class="cfcompare-run" disabled>COMPARE</button></footer></section>
          </div>
        </div>
      </section>`;
    document.body.appendChild(compareBackdrop);
    compareBackdrop
      .querySelector(".cfcompare-close")
      .addEventListener("click", closeCompare);
    compareBackdrop.addEventListener("click", (event) => {
      if (event.target === compareBackdrop) closeCompare();
    });
    compareBackdrop
      .querySelector(".cfcompare-run")
      .addEventListener("click", compareSelected);
    compareBackdrop
      .querySelector(".cfcompare-picker-toggle")
      .addEventListener("click", () =>
        setComparePickerOpen(
          compareBackdrop
            .querySelector(".cfcompare-picker-menu")
            .hasAttribute("hidden"),
        ),
      );
    compareBackdrop.addEventListener("click", (event) => {
      if (!event.target.closest(".cfcompare-picker"))
        setComparePickerOpen(false);
    });
  }
  function setComparePickerOpen(open) {
    if (!compareBackdrop) return;
    const menu = compareBackdrop.querySelector(".cfcompare-picker-menu"),
      button = compareBackdrop.querySelector(".cfcompare-picker-toggle");
    if (!menu || !button) return;
    menu.toggleAttribute("hidden", !open);
    button.setAttribute("aria-expanded", String(open));
  }
  function openCompare(button) {
    const backdrop = button && button.closest(".cob-backdrop");
    activeCompareCaseKey = String(
      (backdrop && backdrop.dataset.cobSyncKey) || "",
    );
    comparisonAnnotationSide = "original";
    ensureCompareUi();
    compareBackdrop
      .querySelectorAll(".cfcompare-select")
      .forEach((input) => (input.checked = false));
    const result = compareBackdrop.querySelector(".cfcompare-result");
    result.hidden = true;
    result.replaceChildren();
    compareBackdrop
      .querySelectorAll(".cfcomments-wrap,.cfcompare-vice")
      .forEach((element) => element.remove());
    compareBackdrop.classList.add("is-open");
    renderSubmissionHistory();
    if (roomCode) setComparePickerOpen(true);
  }
  function closeCompare() {
    if (compareBackdrop) {
      setComparePickerOpen(false);
      compareBackdrop.classList.remove("is-open");
    }
  }
  function selectedSubmissionIds() {
    if (!compareBackdrop) return [];
    return Array.from(
      compareBackdrop.querySelectorAll(".cfcompare-select:checked"),
    ).map((input) => input.value);
  }
  function updateCompareSelection(changedInput) {
    const selected = selectedSubmissionIds();
    const notice = compareBackdrop.querySelector(".cfcompare-notice");
    if (selected.length > 2 && changedInput) {
      changedInput.checked = false;
      notice.textContent = "एक पटकमा ठीक २ वटा file मात्र छान्न सकिन्छ।";
    } else notice.textContent = "";
    const finalSelection = selectedSubmissionIds();
    compareBackdrop.querySelector(".cfcompare-count").textContent =
      nepaliDigits(finalSelection.length) + "/२ छनोट";
    const pickerLabel = compareBackdrop.querySelector(
      ".cfcompare-picker-toggle span",
    );
    if (pickerLabel)
      pickerLabel.textContent =
        "Files · " + nepaliDigits(finalSelection.length) + "/२";
    compareBackdrop.querySelector(".cfcompare-run").disabled =
      finalSelection.length !== 2;
  }
  function renderSubmissionHistory() {
    if (!compareBackdrop) return;
    const selected = new Set(selectedSubmissionIds());
    const list = compareBackdrop.querySelector(".cfcompare-list");
    list.replaceChildren();
    if (!roomCode) {
      const message = document.createElement("p");
      message.className = "cfcompare-empty";
      message.textContent =
        "Shared history हेर्न पहिले Realtime Sync मा connect गर्नुहोस्।";
      list.appendChild(message);
      updateCompareSelection();
      return;
    }
    if (!submissionsCache.length) {
      updateCompareSelection();
      return;
    }
    submissionsCache.forEach((item) => {
      const row = document.createElement("article");
      row.className = "cfcompare-item";
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "cfcompare-select";
      input.value = item.id;
      input.setAttribute("data-firebase-ignore", "");
      input.checked = selected.has(item.id);
      input.addEventListener("change", () => updateCompareSelection(input));
      const info = document.createElement("span");
      info.className = "cfcompare-info";
      const file = document.createElement("strong");
      file.textContent = item.fileName || "submitted-preview.html";
      const meta = document.createElement("small");
      meta.textContent =
        (item.userName || "Connector") +
        " · " +
        timestampLabel(item.submittedAt) +
        (item.caseTitle ? " · " + item.caseTitle : "");
      info.append(file, meta);
      label.append(input, info);
      const download = document.createElement("button");
      download.type = "button";
      download.className = "cfcompare-download";
      download.textContent = "↓";
      download.title = "Submitted file download";
      download.setAttribute("aria-label", "Submitted file download");
      download.addEventListener("click", () => downloadSubmission(item));
      row.append(label, download);
      list.appendChild(row);
    });
    updateCompareSelection();
  }
  function submissionDocument(item) {
    return (
      '<!doctype html><html lang="ne"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      escapeHtml(item.fileName) +
      '</title><style>body{max-width:850px;margin:36px auto;padding:0 28px;color:#111;background:#fff;font:13pt/1.15 Kalimati,"Noto Serif Devanagari","Nirmala UI",serif}header{margin-bottom:28px;padding-bottom:12px;border-bottom:1px solid #bbb;font:12px/1.5 system-ui,sans-serif;color:#555}article p{margin:0;text-align:justify}.cob-center{text-align:center} .cob-right{text-align:right}.cob-left{text-align:left}.cob-bold{font-weight:700}.cob-underline,.cob-title{text-decoration:underline}.cob-party,.cob-iti{display:flex;gap:5px;align-items:flex-end}.cob-party-leader,.cob-iti-leader{flex:1;border-bottom:1px dotted currentColor}</style></head><body><header><strong>' +
      escapeHtml(item.fileName) +
      "</strong><br>Submitted by " +
      escapeHtml(item.userName) +
      " · " +
      escapeHtml(timestampLabel(item.submittedAt)) +
      "</header><article>" +
      sanitizeStoredHtml(item.draftHtml) +
      "</article></body></html>"
    );
  }
  function downloadSubmission(item) {
    const blob = new Blob(["\ufeff", submissionDocument(item)], {
      type: "text/html;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = item.fileName || "submitted-preview.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }
  function normalizedDiffText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function blockText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone
      .querySelectorAll("br")
      .forEach((breakElement) => breakElement.replaceWith("\n"));
    return String(clone.textContent || "").replace(/\r/g, "");
  }
  function normalizedBlockDiffText(value) {
    return String(value || "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
  }
  function documentDiffSignature(article) {
    return Array.from((article && article.children) || [])
      .map((element) => normalizedBlockDiffText(blockText(element)))
      .join("\n\u241e\n");
  }
  function sequenceDiff(original, latest, normalizer = normalizedDiffText) {
    const left = original.map(normalizer),
      right = latest.map(normalizer),
      rows = left.length,
      columns = right.length,
      matrix = Array.from(
        { length: rows + 1 },
        () => new Uint16Array(columns + 1),
      );
    for (let row = rows - 1; row >= 0; row -= 1)
      for (let column = columns - 1; column >= 0; column -= 1)
        matrix[row][column] =
          left[row] === right[column]
            ? matrix[row + 1][column + 1] + 1
            : Math.max(matrix[row + 1][column], matrix[row][column + 1]);
    const operations = [];
    let row = 0,
      column = 0;
    while (row < rows || column < columns) {
      if (row < rows && column < columns && left[row] === right[column]) {
        operations.push({ type: "equal", original: row, latest: column });
        row += 1;
        column += 1;
      } else if (
        row < rows &&
        (column >= columns ||
          matrix[row + 1][column] >= matrix[row][column + 1])
      ) {
        operations.push({ type: "delete", original: row, latest: null });
        row += 1;
      } else {
        operations.push({ type: "insert", original: null, latest: column });
        column += 1;
      }
    }
    return operations;
  }
  function splitComparisonUnits(text) {
    const value = String(text || "");
    if (value.includes("\n"))
      return {
        mode: "line",
        units: (value.match(/[^\n]*(?:\n|$)/g) || []).filter(Boolean),
      };
    return {
      mode: "sentence",
      units: (
        value.match(/[^।.!?！？]+[।.!?！？]+(?:\s+|$)|[^।.!?！？]+$/g) || [
          value,
        ]
      ).filter((unit) => unit.length),
    };
  }
  function wordSimilarity(original, latest) {
    const left = normalizedDiffText(original).split(" ").filter(Boolean),
      right = normalizedDiffText(latest).split(" ").filter(Boolean);
    if (!left.length && !right.length) return 1;
    if (!left.length || !right.length) return 0;
    const operations = sequenceDiff(left, right, (value) => value),
      equal = operations.filter(
        (operation) => operation.type === "equal",
      ).length;
    return (2 * equal) / (left.length + right.length);
  }
  function shortQuote(value) {
    const text = normalizedDiffText(value);
    return text.length > 150 ? text.slice(0, 147) + "…" : text;
  }
  function changeTextElement(tagName, text, className) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }
  function wordUnits(value) {
    return String(value || "").match(/\S+\s*/gu) || [];
  }
  function renderWordChanges(container, originalText, latestText) {
    const originalWords = wordUnits(originalText),
      latestWords = wordUnits(latestText);
    if (
      !originalWords.length ||
      !latestWords.length ||
      originalWords.length + latestWords.length > 240 ||
      wordSimilarity(originalText, latestText) < 0.25
    )
      return false;
    const operations = sequenceDiff(
      originalWords,
      latestWords,
      normalizedDiffText,
    );
    for (let index = 0; index < operations.length; ) {
      if (operations[index].type === "equal") {
        const span = document.createElement("span");
        span.textContent = originalWords[operations[index].original];
        container.appendChild(span);
        index += 1;
        continue;
      }
      const group = [];
      while (index < operations.length && operations[index].type !== "equal")
        group.push(operations[index++]);
      const removed = group
          .filter((operation) => operation.type === "delete")
          .map((operation) => originalWords[operation.original])
          .join(""),
        added = group
          .filter((operation) => operation.type === "insert")
          .map((operation) => latestWords[operation.latest])
          .join("");
      if (removed)
        container.appendChild(
          changeTextElement("del", removed, "cfcompare-removed"),
        );
      if (added)
        container.appendChild(
          changeTextElement("ins", added, "cfcompare-added"),
        );
    }
    return true;
  }
  function legacyGranularCompare(
    targetElement,
    originalText,
    latestText,
    comments,
  ) {
    const originalSplit = splitComparisonUnits(originalText),
      latestSplit = splitComparisonUnits(latestText),
      mode =
        originalSplit.mode === "line" || latestSplit.mode === "line"
          ? "line"
          : "sentence",
      originalUnits =
        mode === "line"
          ? splitComparisonUnits(originalText.replace(/([^\n])$/, "$1\n")).units
          : originalSplit.units,
      latestUnits =
        mode === "line"
          ? splitComparisonUnits(latestText.replace(/([^\n])$/, "$1\n")).units
          : latestSplit.units,
      operations = sequenceDiff(originalUnits, latestUnits),
      label = mode === "line" ? "पङ्क्ति" : "वाक्य";
    targetElement.replaceChildren();
    for (let index = 0; index < operations.length; ) {
      if (operations[index].type === "equal") {
        const span = document.createElement("span");
        span.textContent = originalUnits[operations[index].original];
        targetElement.appendChild(span);
        index += 1;
        continue;
      }
      const group = [];
      while (index < operations.length && operations[index].type !== "equal")
        group.push(operations[index++]);
      const deleted = group
          .filter((operation) => operation.type === "delete")
          .map((operation) => originalUnits[operation.original]),
        inserted = group
          .filter((operation) => operation.type === "insert")
          .map((operation) => latestUnits[operation.latest]),
        reference =
          (
            group.find((operation) => operation.latest !== null) ||
            group.find((operation) => operation.original !== null) ||
            {}
          ).latest ??
          (group.find((operation) => operation.original !== null) || {})
            .original ??
          0;
      const modified = deleted.length && inserted.length,
        removedText = deleted.join(""),
        addedText = inserted.join(""),
        change = document.createElement("span"),
        wordLevel =
          modified &&
          deleted.length === 1 &&
          inserted.length === 1 &&
          renderWordChanges(change, removedText, addedText);
      change.className = "cfcompare-unit-change";
      if (!wordLevel) {
        if (removedText)
          change.appendChild(
            changeTextElement("del", removedText, "cfcompare-removed"),
          );
        if (addedText)
          change.appendChild(
            changeTextElement("ins", addedText, "cfcompare-added"),
          );
      }
      targetElement.appendChild(change);
      comments.push({
        type: modified ? "modified" : inserted.length ? "added" : "removed",
        scope:
          label +
          " " +
          nepaliDigits(reference + 1) +
          (wordLevel ? " · शब्दगत" : ""),
        oldText: removedText ? shortQuote(removedText) : "",
        newText: addedText ? shortQuote(addedText) : "",
        wordLevel: wordLevel,
      });
    }
  }
  function proofreaderEngine() {
    return window.NepaliProofreaderEngine || null;
  }
  function combinedUnitText(units, mode) {
    return (units || [])
      .map((unit) => unit.text)
      .join(mode === "line" ? "" : " ");
  }
  function proofCommentCategory(event) {
    if (!event) return "substantive";
    if (event.category === "proof" || event.type === "proof") return "proof";
    if (String(event.type || "").startsWith("PUNCTUATION"))
      return "punctuation";
    if (
      event.kind === "minor" ||
      [
        "MINOR_SPELLING",
        "VOWEL_LENGTH",
        "NORMALIZER_CHANGE",
        "WORD_FUSION",
        "WORD_DISSOCIATION",
        "SENTENCE_MERGE",
        "SENTENCE_SPLIT",
      ].includes(event.type)
    )
      return "minor";
    return "substantive";
  }
  function engineEventComment(event, scope, anchorId) {
    const engine = proofreaderEngine(),
      type =
        event.type === "WORD_ADDITION" || event.type === "SENTENCE_ADDITION"
          ? "added"
          : event.type === "WORD_DELETION" ||
              event.type === "SENTENCE_DELETION"
            ? "removed"
            : "modified",
      flags = Array.from(
        new Set(
          (event.changeTypes || [event.type])
            .map((changeType) =>
              engine && engine.labels
                ? engine.labels[changeType] || changeType
                : changeType,
            )
            .concat(event.flags || []),
        ),
      );
    return {
      type,
      category: proofCommentCategory(event),
      scope,
      label:
        event.label ||
        (engine && engine.labels && engine.labels[event.type]) ||
        "Text परिवर्तन",
      oldText: event.oldText || "",
      newText: event.newText || "",
      flags,
      reason:
        event.reason ||
        (engine && engine.eventReason ? engine.eventReason(event) : ""),
      mapping:
        engine && engine.confidenceText
          ? engine.confidenceText(event.mappingConfidence)
          : "संरचनात्मक mapping",
      countedAsSubstantive: Boolean(event.countedAsSubstantive),
      heavy: event.type === "SENTENCE_MODIFICATION",
      regions: event.regions || 0,
      anchorId: anchorId || "",
    };
  }
  function appendEnginePair(
    container,
    analysis,
    originalText,
    latestText,
    comments,
    scope,
    anchorId,
  ) {
    if (analysis.heavy) {
      container.classList.add("cfcompare-heavy-sentence");
      renderWholeChange(container, originalText, latestText);
      analysis.events.forEach((event) =>
        comments.push(engineEventComment(event, scope, anchorId)),
      );
      return;
    }
    const useLatestSpacing = comparisonAnnotationSide === "latest";
    analysis.blocks.forEach((block, index) => {
      if (block.equal) {
        const token = useLatestSpacing
          ? block.equal.latest
          : block.equal.original;
        container.appendChild(
          document.createTextNode((token.pre || "") + token.text),
        );
        return;
      }
      const event = block.event,
        wrapper = document.createElement("span"),
        blockAnchor = anchorId + "-" + index;
      wrapper.className =
        "cfcompare-unit-change cfcompare-proof-" + proofCommentCategory(event);
      wrapper.id = blockAnchor;
      if (event.oldText)
        wrapper.appendChild(
          changeTextElement("del", event.oldText, "cfcompare-removed"),
        );
      if (event.oldText && event.newText) {
        const arrow = document.createElement("span");
        arrow.className = "cfcompare-inline-arrow";
        arrow.textContent = "→";
        wrapper.appendChild(arrow);
      }
      if (event.newText)
        wrapper.appendChild(
          changeTextElement("ins", event.newText, "cfcompare-added"),
        );
      container.appendChild(wrapper);
      comments.push(engineEventComment(event, scope, blockAnchor));
    });
    const tail = useLatestSpacing
      ? analysis.latestTail || ""
      : String(originalText || "").match(/\s*$/u)?.[0] || "";
    if (tail) container.appendChild(document.createTextNode(tail));
  }
  function granularCompare(targetElement, originalText, latestText, comments) {
    const engine = proofreaderEngine();
    if (!engine || !engine.compareUnits || !engine.analyzePair) {
      legacyGranularCompare(targetElement, originalText, latestText, comments);
      return;
    }
    const mode =
        String(originalText || "").includes("\n") ||
        String(latestText || "").includes("\n")
          ? "line"
          : "sentence",
      comparison = engine.compareUnits(originalText, latestText, mode),
      label = mode === "line" ? "पङ्क्ति" : "वाक्य";
    targetElement.replaceChildren();
    comparison.alignments.forEach((alignment, alignmentIndex) => {
      const originalCombined = combinedUnitText(alignment.old, mode),
        latestCombined = combinedUnitText(alignment.latest, mode),
        reference = alignment.latest[0]
          ? alignment.latest[0].index
          : alignment.old[0]
            ? alignment.old[0].index
            : alignmentIndex,
        scope = label + " " + nepaliDigits(reference + 1),
        anchorId = "cfproof-" + (++comparisonAnchorSequence).toString(36),
        exact =
          alignment.type === "match" &&
          normalizedBlockDiffText(originalCombined) ===
            normalizedBlockDiffText(latestCombined);
      if (exact) {
        targetElement.appendChild(
          document.createTextNode(
            comparisonAnnotationSide === "latest"
              ? latestCombined
              : originalCombined,
          ),
        );
        return;
      }
      if (
        alignment.type === "match" ||
        alignment.type === "merge" ||
        alignment.type === "split"
      ) {
        const wrapper = document.createElement("span"),
          analysis =
            alignment.analysis ||
            engine.analyzePair(originalCombined, latestCombined, {
              mode,
              unitIndex: reference,
              mappingConfidence: alignment.mappingConfidence,
            });
        wrapper.className = "cfcompare-unit-change cfcompare-smart-unit";
        wrapper.id = anchorId;
        appendEnginePair(
          wrapper,
          analysis,
          originalCombined,
          latestCombined,
          comments,
          scope,
          anchorId,
        );
        targetElement.appendChild(wrapper);
        if (alignment.type === "merge" || alignment.type === "split") {
          const structuralType =
            alignment.type === "merge" ? "SENTENCE_MERGE" : "SENTENCE_SPLIT";
          comments.unshift(
            engineEventComment(
              {
                type: structuralType,
                label: engine.labels[structuralType],
                kind: "minor",
                oldText: originalCombined,
                newText: latestCombined,
                changeTypes: [structuralType],
                flags: [],
                mappingConfidence: alignment.mappingConfidence,
                countedAsSubstantive: false,
              },
              scope,
              anchorId,
            ),
          );
        }
        return;
      }
      const wrapper = document.createElement("span"),
        event = {
          type:
            alignment.type === "add"
              ? "SENTENCE_ADDITION"
              : "SENTENCE_DELETION",
          label:
            engine.labels[
              alignment.type === "add"
                ? "SENTENCE_ADDITION"
                : "SENTENCE_DELETION"
            ],
          kind: alignment.type === "add" ? "substantive" : "deletion",
          oldText: originalCombined,
          newText: latestCombined,
          changeTypes: [
            alignment.type === "add"
              ? "SENTENCE_ADDITION"
              : "SENTENCE_DELETION",
          ],
          flags: [],
          mappingConfidence: 1,
          countedAsSubstantive: true,
        };
      wrapper.id = anchorId;
      wrapper.className = "cfcompare-unit-change";
      if (originalCombined)
        wrapper.appendChild(
          changeTextElement("del", originalCombined, "cfcompare-removed"),
        );
      if (latestCombined)
        wrapper.appendChild(
          changeTextElement("ins", latestCombined, "cfcompare-added"),
        );
      targetElement.appendChild(wrapper);
      comments.push(engineEventComment(event, scope, anchorId));
    });
  }
  function renderWholeChange(element, originalText, latestText) {
    element.replaceChildren();
    const flow = document.createElement("span"),
      arrow = document.createElement("span");
    flow.className = "cfcompare-heavy-flow";
    arrow.className = "cfcompare-inline-arrow";
    arrow.textContent = "→";
    if (originalText)
      flow.appendChild(
        changeTextElement("del", originalText, "cfcompare-removed"),
      );
    if (originalText && latestText) flow.appendChild(arrow);
    if (latestText)
      flow.appendChild(changeTextElement("ins", latestText, "cfcompare-added"));
    element.appendChild(flow);
  }
  function markDocumentChanges(
    originalArticle,
    latestArticle,
    annotationSide = "original",
  ) {
    const originalBlocks = Array.from(originalArticle.children),
      latestBlocks = Array.from(latestArticle.children),
      originalTexts = originalBlocks.map(blockText),
      latestTexts = latestBlocks.map(blockText),
      operations = sequenceDiff(
        originalTexts,
        latestTexts,
        normalizedBlockDiffText,
      ),
      comments = [],
      annotatedBlocks = [];
    for (let index = 0; index < operations.length; ) {
      if (operations[index].type === "equal") {
        const operation = operations[index],
          source =
            annotationSide === "latest"
              ? latestBlocks[operation.latest]
              : originalBlocks[operation.original];
        if (source) annotatedBlocks.push(source.cloneNode(true));
        index += 1;
        continue;
      }
      const group = [];
      while (index < operations.length && operations[index].type !== "equal")
        group.push(operations[index++]);
      const deleted = group.filter((operation) => operation.type === "delete"),
        inserted = group.filter((operation) => operation.type === "insert");
      if (deleted.length === 1 && inserted.length === 1) {
        const originalIndex = deleted[0].original,
          latestIndex = inserted[0].latest,
          originalElement = originalBlocks[originalIndex],
          latestElement = latestBlocks[latestIndex],
          targetElement = (
            annotationSide === "latest" ? latestElement : originalElement
          ).cloneNode(true),
          structural =
            originalElement.matches(".cob-party,.cob-iti") ||
            latestElement.matches(".cob-party,.cob-iti"),
          engine = proofreaderEngine(),
          smartSimilarity = engine && engine.similarity
            ? engine.similarity(
                originalTexts[originalIndex],
                latestTexts[latestIndex],
              )
            : wordSimilarity(
                originalTexts[originalIndex],
                latestTexts[latestIndex],
              ),
          heavy = structural || smartSimilarity < 0.18;
        if (heavy) {
          targetElement.classList.add("cfcompare-different");
          renderWholeChange(
            targetElement,
            originalTexts[originalIndex],
            latestTexts[latestIndex],
          );
          comments.push({
            type: "modified",
            scope:
              "अनुच्छेद " +
              nepaliDigits(latestIndex + 1) +
              " · व्यापक परिवर्तन",
            oldText: shortQuote(originalTexts[originalIndex]),
            newText: shortQuote(latestTexts[latestIndex]),
            heavy: true,
          });
        } else
          granularCompare(
            targetElement,
            originalTexts[originalIndex],
            latestTexts[latestIndex],
            comments,
          );
        annotatedBlocks.push(targetElement);
        continue;
      }
      deleted.forEach((operation) => {
        const element = originalBlocks[operation.original]?.cloneNode(true);
        if (element) {
          element.classList.add("cfcompare-removed-block");
          if (inserted.length) element.classList.add("cfcompare-different");
          annotatedBlocks.push(element);
        }
      });
      inserted.forEach((operation) => {
        const element = latestBlocks[operation.latest]?.cloneNode(true);
        if (element) {
          element.classList.add("cfcompare-added-block");
          if (deleted.length) element.classList.add("cfcompare-different");
          annotatedBlocks.push(element);
        }
      });
      if (deleted.length && inserted.length)
        comments.push({
          type: "modified",
          scope:
            "अनुच्छेद समूह · Original " +
            nepaliDigits(deleted.length) +
            " → Latest " +
            nepaliDigits(inserted.length),
          oldText: shortQuote(
            deleted
              .map((operation) => originalTexts[operation.original])
              .join(" "),
          ),
          newText: shortQuote(
            inserted
              .map((operation) => latestTexts[operation.latest])
              .join(" "),
          ),
          heavy: true,
        });
      else if (inserted.length)
        comments.push({
          type: "added",
          scope: nepaliDigits(inserted.length) + " नयाँ अनुच्छेद",
          oldText: "",
          newText: shortQuote(
            inserted
              .map((operation) => latestTexts[operation.latest])
              .join(" "),
          ),
        });
      else
        comments.push({
          type: "removed",
          scope: nepaliDigits(deleted.length) + " हटाइएका अनुच्छेद",
          oldText: shortQuote(
            deleted
              .map((operation) => originalTexts[operation.original])
              .join(" "),
          ),
          newText: "",
        });
    }
    const targetArticle =
        annotationSide === "latest" ? latestArticle : originalArticle,
      intactArticle =
        annotationSide === "latest" ? originalArticle : latestArticle;
    targetArticle.replaceChildren(...annotatedBlocks);
    targetArticle.classList.add("is-annotated");
    intactArticle.classList.add("is-intact");
    return comments;
  }
  function renderChangeComment(comment) {
    const item = document.createElement("li"),
      head = document.createElement("div"),
      badge = document.createElement("span"),
      scope = document.createElement("strong"),
      flow = document.createElement("div"),
      flags = document.createElement("div"),
      detail = document.createElement("div"),
      reason = document.createElement("p");
    item.className = "cfcomment cfcomment-" + comment.type;
    item.dataset.category = comment.category || proofCommentCategory(comment);
    if (comment.heavy) item.classList.add("is-heavy");
    if (comment.anchorId) {
      item.tabIndex = 0;
      item.classList.add("is-focusable");
      const focus = () => {
        const anchor = document.getElementById(comment.anchorId);
        if (!anchor) return;
        anchor.scrollIntoView({ behavior: "smooth", block: "center" });
        anchor.classList.add("cfcompare-focus");
        setTimeout(() => anchor.classList.remove("cfcompare-focus"), 1800);
      };
      item.addEventListener("click", focus);
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focus();
      });
    }
    head.className = "cfcomment-head";
    badge.className = "cfcomment-badge";
    badge.textContent =
      comment.type === "proof"
        ? "✓ प्रूफरीड"
        : comment.type === "added"
        ? "+ थपिएको"
        : comment.type === "removed"
          ? "− हटाइएको"
          : "→ परिमार्जित";
    scope.textContent =
      (comment.label ? comment.label + " · " : "") +
      (comment.scope || "Text परिवर्तन");
    head.append(badge, scope);
    flow.className = "cfcomment-flow";
    if (comment.oldText) {
      const oldText = document.createElement("del");
      oldText.textContent = comment.oldText;
      flow.appendChild(oldText);
    }
    if (comment.oldText && comment.newText) {
      const arrow = document.createElement("span");
      arrow.className = "cfcomment-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-label", "बाट");
      flow.appendChild(arrow);
    }
    if (comment.newText) {
      const newText = document.createElement("ins");
      newText.textContent = (comment.type === "proof" ? "✓ " : "+ ") + comment.newText;
      flow.appendChild(newText);
    }
    flags.className = "cfcomment-flags";
    (comment.flags || []).slice(0, 8).forEach((flag) => {
      const chip = document.createElement("span");
      chip.textContent = flag;
      flags.appendChild(chip);
    });
    detail.className = "cfcomment-detail";
    if (comment.type !== "proof") {
      const nature = document.createElement("span"),
        mapping = document.createElement("span");
      nature.innerHTML =
        "<b>प्रकृति</b> " +
        (comment.countedAsSubstantive
          ? "Substantive change"
          : "सूक्ष्म/संरचनात्मक");
      mapping.innerHTML =
        "<b>Mapping</b> " + escapeHtml(comment.mapping || "संरचनात्मक mapping");
      detail.append(nature, mapping);
    }
    reason.className = "cfcomment-reason";
    reason.textContent = comment.reason || "";
    item.append(head, flow);
    if (flags.childElementCount) item.appendChild(flags);
    if (detail.childElementCount) item.appendChild(detail);
    if (reason.textContent) item.appendChild(reason);
    return item;
  }
  function comparisonPlainText(article) {
    return Array.from((article && article.children) || [])
      .map(blockText)
      .join("\n");
  }
  function proofreadingComments(text) {
    const engine = proofreaderEngine();
    if (!engine || !engine.proofreadingSuggestions) return [];
    return engine.proofreadingSuggestions(text).map((suggestion) => ({
      type: "proof",
      category: "proof",
      label: suggestion.label || "भाषिक सुझाव",
      scope: "Latest · अक्षर " + nepaliDigits((suggestion.index || 0) + 1),
      oldText: suggestion.oldText || "",
      newText: suggestion.newText || "",
      flags: suggestion.flags || ["भाषिक/शैलीगत सुझाव"],
      reason: suggestion.reason || "सन्दर्भ हेरी सुझाव जाँच्नुहोस्।",
      countedAsSubstantive: false,
      severity: suggestion.severity || "suggestion",
    }));
  }
  function commentSearchText(comment) {
    return [
      comment.label,
      comment.scope,
      comment.oldText,
      comment.newText,
      comment.reason,
      ...(comment.flags || []),
    ]
      .join(" ")
      .toLocaleLowerCase("ne");
  }
  function comparisonColumn(item, label, grid) {
    const column = document.createElement("section"),
      header = document.createElement("header"),
      title = document.createElement("strong"),
      meta = document.createElement("small"),
      badge = document.createElement("span"),
      download = document.createElement("button"),
      article = document.createElement("article");
    column.className = "cfcompare-column";
    badge.className = "cfcompare-version";
    badge.textContent = label;
    title.textContent = item.fileName;
    meta.textContent =
      item.userName +
      " · last edited " +
      timestampLabel(item.lastEditedAt || item.submittedAt);
    download.type = "button";
    download.textContent = "Download";
    download.addEventListener("click", () => downloadSubmission(item));
    header.append(badge, title, meta, download);
    article.className = "cfcompare-document";
    article.innerHTML = sanitizeStoredHtml(item.draftHtml);
    article.querySelectorAll(".cob-main-body[data-cob-main-body='1']").forEach(
      (body) => body.replaceWith(...body.childNodes),
    );
    column.append(header, article);
    grid.appendChild(column);
    return article;
  }
  function compareSelected() {
    const ids = selectedSubmissionIds();
    if (ids.length !== 2) return;
    const items = ids
      .map((id) =>
        submissionsCache.find((item) => item.id === id),
      )
      .filter(Boolean)
      .sort(
        (a, b) =>
          Number(a.lastEditedAt || a.submittedAt || 0) -
          Number(b.lastEditedAt || b.submittedAt || 0),
      );
    if (items.length !== 2) {
      renderSubmissionHistory();
      return;
    }
    const original = items[0],
      latest = items[1],
      result = compareBackdrop.querySelector(".cfcompare-result"),
      grid = document.createElement("div"),
      floatingTools = compareBackdrop.querySelector(
        ".cfcompare-floating-tools",
      );
    result.replaceChildren();
    floatingTools
      .querySelectorAll(".cfcomments-wrap,.cfcompare-vice")
      .forEach((element) => element.remove());
    grid.className = "cfcompare-grid";
    const originalArticle = comparisonColumn(original, "Original", grid),
      latestArticle = comparisonColumn(latest, "Latest", grid),
      latestProofText = comparisonPlainText(latestArticle),
      same =
        documentDiffSignature(originalArticle) ===
        documentDiffSignature(latestArticle),
      changeComments = same
        ? []
        : markDocumentChanges(
            originalArticle,
            latestArticle,
            comparisonAnnotationSide,
          ),
      proofComments = proofreadingComments(latestProofText),
      comments = changeComments.concat(proofComments),
      annotatedArticle =
        comparisonAnnotationSide === "latest" ? latestArticle : originalArticle,
      annotatedColumn = annotatedArticle.closest(".cfcompare-column"),
      annotationBadge = document.createElement("span"),
      commentsWrap = document.createElement("div"),
      commentsButton = document.createElement("button"),
      commentsPanel = document.createElement("aside"),
      commentsHead = document.createElement("header"),
      commentsTitle = document.createElement("strong"),
      commentsClose = document.createElement("button"),
      commentsNote = document.createElement("p"),
      commentsLegend = document.createElement("div"),
      commentsSummary = document.createElement("div"),
      commentsTools = document.createElement("div"),
      commentsSearch = document.createElement("input"),
      commentsFilters = document.createElement("div"),
      commentsList = document.createElement("ol"),
      viceButton = document.createElement("button");
    annotationBadge.className = "cfcompare-annotation-badge";
    if (!same) {
      annotationBadge.textContent = "Changes shown here";
      annotatedColumn.classList.add("has-annotations");
      annotatedColumn.querySelector("header").appendChild(annotationBadge);
    }
    commentsWrap.className = "cfcomments-wrap";
    commentsButton.type = "button";
    commentsButton.className = "cfcompare-fab cfcomments-toggle";
    commentsButton.setAttribute("aria-expanded", "false");
    commentsButton.textContent =
      "☰ Comments · " + nepaliDigits(comments.length);
    commentsPanel.className = "cfcomments-panel";
    commentsPanel.hidden = true;
    commentsTitle.textContent =
      "Comments · " +
      nepaliDigits(changeComments.length) +
      " परिवर्तन · " +
      nepaliDigits(proofComments.length) +
      " प्रूफरीड";
    commentsClose.type = "button";
    commentsClose.className = "cfcomments-close";
    commentsClose.setAttribute("aria-label", "Comments बन्द गर्नुहोस्");
    commentsClose.textContent = "×";
    commentsHead.append(commentsTitle, commentsClose);
    commentsNote.className = "cfcomments-note";
    commentsNote.textContent = same
      ? "दुवै submitted file को text समान छ; Latest को भाषिक/शैलीगत proofreading छुट्टै देखाइएको छ।"
      : "Smart sentence mapping, Nepali normalizer र change-region analysis अनुसार शब्दगत change देखाइएको छ; कठिन अवस्थामा मात्र sentence/paragraph fallback हुन्छ।";
    commentsLegend.className = "cfcomment-legend";
    commentsLegend.innerHTML =
      '<span class="is-removed">− हटाइएको</span><span class="is-added">+ थपिएको</span><span class="is-modified">→ परिमार्जित</span><span class="is-proof">✓ प्रूफरीड सुझाव</span>';
    const categoryCounts = comments.reduce(
      (counts, comment) => {
        const category = comment.category || proofCommentCategory(comment);
        counts[category] = (counts[category] || 0) + 1;
        return counts;
      },
      {},
    );
    commentsSummary.className = "cfcomment-summary";
    commentsSummary.innerHTML =
      "<span><b>" +
      nepaliDigits(changeComments.length) +
      "</b> परिवर्तन</span><span><b>" +
      nepaliDigits(categoryCounts.minor || 0) +
      "</b> सूक्ष्म</span><span><b>" +
      nepaliDigits(categoryCounts.punctuation || 0) +
      "</b> विरामचिह्न</span><span><b>" +
      nepaliDigits(proofComments.length) +
      "</b> प्रूफरीड</span>";
    commentsTools.className = "cfcomment-tools";
    commentsSearch.className = "cfcomment-search";
    commentsSearch.type = "search";
    commentsSearch.placeholder = "कैफियत वा शब्द खोज्नुहोस्…";
    commentsSearch.setAttribute("aria-label", "Comments खोज्नुहोस्");
    commentsFilters.className = "cfcomment-filters";
    [
      ["all", "सबै"],
      ["substantive", "मूल परिवर्तन"],
      ["minor", "सूक्ष्म"],
      ["punctuation", "विरामचिह्न"],
      ["proof", "प्रूफरीड"],
    ].forEach(([filter, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.filter = filter;
      button.textContent = label;
      button.className = filter === "all" ? "is-active" : "";
      button.setAttribute("aria-pressed", String(filter === "all"));
      commentsFilters.appendChild(button);
    });
    commentsTools.append(commentsSearch, commentsFilters);
    commentsList.className = "cfcomment-list";
    let activeFilter = "all";
    const renderFilteredComments = () => {
      const query = commentsSearch.value.trim().toLocaleLowerCase("ne"),
        visible = comments.filter((comment) => {
          const category = comment.category || proofCommentCategory(comment);
          return (
            (activeFilter === "all" || category === activeFilter) &&
            (!query || commentSearchText(comment).includes(query))
          );
        });
      commentsList.replaceChildren();
      if (visible.length)
        visible.forEach((comment) =>
          commentsList.appendChild(renderChangeComment(comment)),
        );
      else {
        const item = document.createElement("li");
        item.className = "cfcomment-empty";
        item.textContent = comments.length
          ? "यस filter/search मा मिल्ने कैफियत छैन।"
          : "कुनै text परिवर्तन वा proofreading सुझाव भेटिएन।";
        commentsList.appendChild(item);
      }
    };
    commentsSearch.addEventListener("input", renderFilteredComments);
    commentsFilters.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (!button) return;
      activeFilter = button.dataset.filter;
      commentsFilters.querySelectorAll("button").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderFilteredComments();
    });
    renderFilteredComments();
    commentsPanel.append(
      commentsHead,
      commentsNote,
      commentsSummary,
      commentsLegend,
      commentsTools,
      commentsList,
    );
    commentsWrap.append(commentsButton, commentsPanel);
    commentsButton.addEventListener("click", () => {
      const open = commentsPanel.hasAttribute("hidden");
      commentsPanel.toggleAttribute("hidden", !open);
      commentsButton.setAttribute("aria-expanded", String(open));
      if (open) setComparePickerOpen(false);
    });
    commentsClose.addEventListener("click", () => {
      commentsPanel.hidden = true;
      commentsButton.setAttribute("aria-expanded", "false");
    });
    viceButton.type = "button";
    viceButton.className = "cfcompare-fab cfcompare-vice";
    viceButton.textContent =
      "⇄ Show on " +
      (comparisonAnnotationSide === "original" ? "Latest" : "Original");
    viceButton.addEventListener("click", () => {
      comparisonAnnotationSide =
        comparisonAnnotationSide === "original" ? "latest" : "original";
      compareSelected();
    });
    floatingTools.append(commentsWrap, viceButton);
    result.append(grid);
    result.hidden = false;
    setComparePickerOpen(false);
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.addEventListener("input", (event) => queueField(event.target), true);
  document.addEventListener(
    "change",
    (event) => queueField(event.target),
    true,
  );
  document.addEventListener("input", (event) => {
    if (
      event.target.closest &&
      event.target.closest(".cob-backdrop") &&
      event.target.id === "cobDraft"
    ) {
      rememberDraftPosition(!applyingRemote);
      queueDraft();
    }
  });
  document.addEventListener("change", (event) => {
    if (
      event.target.closest &&
      event.target.closest(".cob-backdrop") &&
      ["cobType", "cobPartyStatus"].includes(event.target.id)
    ) {
      if (!applyingRemote) rememberDraftPosition(true);
      queueDraft();
    }
  });
  document.addEventListener("click", (event) => {
    if (
      event.target.closest &&
      event.target.closest(".cob-backdrop [data-reverse-mode]")
    ) {
      if (!applyingRemote) rememberDraftPosition(true);
      queueDraft();
    }
  });
  document.addEventListener("selectionchange", () => {
    clearTimeout(rememberDraftPosition.selectionTimer);
    rememberDraftPosition.selectionTimer = setTimeout(
      () => rememberDraftPosition(false),
      120,
    );
  });
  document.addEventListener(
    "scroll",
    (event) => {
      if (event.target && event.target.matches?.(".cob-modal")) {
        clearTimeout(rememberDraftPosition.scrollTimer);
        rememberDraftPosition.scrollTimer = setTimeout(
          () => rememberDraftPosition(false),
          140,
        );
      }
    },
    true,
  );
  document.addEventListener("cause-list:field-snapshot", () => {
    if (roomCode && !applyingRemote)
      captureAllFields().catch((error) =>
        syncError("Input snapshot sync गर्न सकिएन।", error),
      );
  });
  document.addEventListener("cause-list:preview-updated", (event) => {
    if (!roomCode || applyingRemote) return;
    captureAllFields().catch(() => {});
    const state = Object.assign({}, event.detail || {}, previewState() || {}, {
      updatedAt: Date.now(),
      updatedBy: deviceId,
    });
    adapter
      .set(basePath + "/pages/" + pageId + "/preview", state)
      .catch((error) => syncError("Preview sync गर्न सकिएन।", error));
  });
  document.addEventListener("cause-list:draft-open", (event) => {
    currentDraftKey = String((event.detail && event.detail.key) || "");
    currentDraftHash = currentDraftKey ? hash(currentDraftKey) : "";
    localDraftEditedAt = 0;
    draftLastEditedAt = Number((readDraftPosition() || {}).editedAt || 0);
    if (roomCode) startDraftSubscription();
  });
  document.addEventListener("cause-list:draft-close", () => {
    rememberDraftPosition(false);
    currentDraftKey = "";
    currentDraftHash = "";
    draftLastEditedAt = 0;
    if (draftUnsub) {
      try {
        draftUnsub();
      } catch (error) {}
      draftUnsub = null;
    }
  });
  document.addEventListener("cause-list:submissions-updated", () => {
    if (compareBackdrop && compareBackdrop.classList.contains("is-open"))
      renderSubmissionHistory();
  });
  new MutationObserver(() => {
    applyPendingFields();
    injectSubmissionButtons();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("online", () => {
    if (roomCode) setStatus("Network पुनः उपलब्ध भयो—sync सक्रिय छ।", "online");
  });
  window.addEventListener("offline", () => {
    if (roomCode) setStatus("Network छैन; local editing जारी रहन्छ।", "error");
  });
  window.CauseListRealtimeSync = {
    connect: (code, userName) => {
      if (nameInput && cleanUserName(userName))
        nameInput.value = cleanUserName(userName);
      return connectRoom(code, false);
    },
    generate: (code, userName) => {
      if (nameInput && cleanUserName(userName))
        nameInput.value = cleanUserName(userName);
      return connectRoom(
        code || String(Math.floor(Math.random() * 900) + 100),
        true,
      );
    },
    disconnect: () => disconnectRoom(true),
    get code() {
      return roomCode;
    },
    get connected() {
      return !!(roomCode && presenceSlot);
    },
    get userName() {
      return connectedUserName;
    },
    getSubmissions: () => submissionsCache.map(publicSubmission),
    submitPreview: submitPreview,
    captureAllFields: captureAllFields,
    captureMainPreview: captureMainPreview,
    captureDraft: captureDraft,
    _hash: hash,
  };
  function boot() {
    injectUi();
    injectSubmissionButtons();
    let stored = "",
      storedName = "";
    try {
      stored = validCode(localStorage.getItem(ROOM_STORAGE) || "");
      storedName = cleanUserName(localStorage.getItem(NAME_STORAGE) || "");
    } catch (error) {}
    if (storedName) nameInput.value = storedName;
    if (stored && storedName) {
      codeInput.value = stored;
      connectRoom(stored, false, { silent: true });
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
