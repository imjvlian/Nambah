"use client";

import { useEffect, useRef, useState } from "react";

type WidgetMessage = {
  role: "user" | "assistant";
  content: string;
};

const QUICK_REPLIES = [
  "Cek status order saya",
  "Cara top up",
  "Daftar produk & harga",
  "Hubungi admin",
];

const SUPPORT_WHATSAPP =
  process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.trim() ?? "";

const GREETING: WidgetMessage = {
  role: "assistant",
  content:
    "Halo! Aku Nambah Assistant. Ada yang bisa dibantu — status order, produk, pembayaran, atau hubungi admin?",
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<WidgetMessage[]>([GREETING]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const nextMessages: WidgetMessage[] = [
      ...messages,
      { role: "user", content },
    ];
    setMessages(nextMessages);
    setDraft("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          messages: nextMessages.slice(-12).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const body = (await response.json()) as {
        reply?: string;
        error?: string;
      };
      if (!response.ok || !body.reply) {
        throw new Error(body.error ?? "Assistant belum bisa menjawab.");
      }
      setMessages([...nextMessages, { role: "assistant", content: body.reply }]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Assistant belum bisa menjawab. Coba lagi sebentar lagi.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function handleQuickReply(label: string) {
    if (label === "Hubungi admin" && SUPPORT_WHATSAPP) {
      window.open(
        `https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, "")}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    void send(label);
  }

  return (
    <>
      <button
        type="button"
        className={"chat-fab" + (open ? " open" : "")}
        aria-label={open ? "Tutup chat bantuan" : "Buka chat bantuan"}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "✕" : "💬"}
      </button>

      {open && (
        <section className="chat-panel" aria-label="Chat bantuan Nambah">
          <header className="chat-header">
            <div>
              <strong>Nambah Assistant</strong>
              <span>CS digital · online</span>
            </div>
            <button
              type="button"
              aria-label="Tutup"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </header>

          <div className="chat-messages" ref={listRef}>
            {messages.map((message, index) => (
              <div
                key={index}
                className={"chat-msg " + (message.role === "user" ? "user" : "bot")}
              >
                {message.content.split("\n").map((line, lineIndex) => (
                  <p key={lineIndex}>{line}</p>
                ))}
              </div>
            ))}
            {busy && <div className="chat-msg bot typing">Mengetik…</div>}
          </div>

          <div className="chat-quick">
            {QUICK_REPLIES.map((label) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => handleQuickReply(label)}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            className="chat-input"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <input
              value={draft}
              maxLength={1000}
              placeholder="Tulis pertanyaanmu…"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              Kirim
            </button>
          </form>
        </section>
      )}
    </>
  );
}
