"use strict";
(async () => {
  const status = document.getElementById("status");
  const token = location.hash.slice(1);
  if (!/^[a-f0-9]{64}$/.test(token)) {
    status.textContent = "Abra o botão Gerar fatura na conversa do WhatsApp.";
    return;
  }
  try {
    const response = await fetch("https://yzhjtqwpmxhigrijiuze.supabase.co/functions/v1/bussi-whatsapp", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({action: "abrir_fatura", token}),
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) {
      status.textContent = "O link expirou ou está inválido. Fale com a Consig Benefícios pelo WhatsApp.";
      return;
    }
    if (!response.ok) throw Error("Fatura indisponível");
    const {numero, token: invoiceToken} = await response.json();
    if (!Number.isSafeInteger(numero) || numero < 1 || !/^[a-f0-9]{64}$/.test(invoiceToken)) throw Error("Fatura inválida");
    location.replace("https://pay.consigbeneficio.com.br/fatura" + String(numero).padStart(4, "0") + "#" + invoiceToken);
  } catch {
    status.textContent = "Não foi possível abrir a fatura. Atualize esta página para tentar novamente.";
  }
})();