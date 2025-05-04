function createBridgeHandler(port, app) {
  let idCounter = 0;
  const pending = new Map();
  const subscriptions = new Map();

  async function handleCommand(path, args) {
    let current = app;
    for (const part of path) {
      current = current[part];
      if (!current) throw new Error(`Invalid path: ${path.join(".")}`);
    }

    if (typeof current !== "function") {
      return current;
    }

    return current(...args);
  }

  port.onmessage = async (event) => {
    const { data } = event;

    // Handle method calls
    if (data.type === "bridge-command") {
      try {
        console.log("bridge-command", data.path, data.args);
        const result = await handleCommand(data.path, data.args);
        port.postMessage({
          type: "bridge-response",
          id: data.id,
          result: JSON.parse(JSON.stringify(result)), // Simple serialization
        });
      } catch (error) {
        console.log("bridge-command-error", error);
        port.postMessage({
          type: "bridge-response",
          id: data.id,
          error: error.message,
        });
      }
    }

    // Handle subscriptions
    if (data.type === "bridge-subscribe") {
      const unsub = app.accounts.subscribe((accounts) => {
        port.postMessage({
          type: "bridge-update",
          subId: data.subId,
          result: JSON.parse(JSON.stringify(accounts)),
        });
      });

      subscriptions.set(data.subId, unsub);
    }

    if (data.type === "bridge-unsubscribe") {
      const unsub = subscriptions.get(data.subId);
      if (unsub) {
        unsub();
        subscriptions.delete(data.subId);
      }
    }
  };
}

function windowInjectedWeb3() {
  if (!window.injectedWeb3 || Object.keys(window.injectedWeb3).length === 0) {
    console.error("InjectedWeb3 not found");
  }
  if ("subwallet-js" in window.injectedWeb3) {
    return window.injectedWeb3["subwallet-js"];
  }
  if ("polkadot-js" in window.injectedWeb3) {
    return window.injectedWeb3["polkadot-js"];
  }
  return window.injectedWeb3[Object.keys(window.injectedWeb3)[0]];
}
