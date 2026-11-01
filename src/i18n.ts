import { MAX_CONNECTIONS } from "../shared/limits";
import { getLang, type Lang } from "./prefs";

type Table = Record<string, string>;

const en: Table = {
  "l.h": "Open an address. Start typing.",
  "l.sub":
    "A shared pad for anything. Everyone on the same address sees the same text, live. No account, no setup.",
  "l.ph": "name-your-pad",
  "l.open": "Open",
  "l.opensas": "Opens as",
  "l.err.invalid": "Use letters, numbers and hyphens, up to 64 characters.",
  "l.err.reserved": "That address is reserved. Try another one.",
  "l.random": "Or start with a random address",
  "l.shuffle": "Another random address",
  "l.recent": "Recently opened on this device",
  "l.note":
    "Pads are public. Anyone who knows the address can read and edit it, and the operator can see every pad.",
  "e.share": "Share",
  "e.preview": "Preview",
  "e.edit": "Edit",
  "e.more": "More",
  "e.home": "Back to start",
  "e.copyLink": "Copy link",
  "e.words": "words",
  "e.you": "You",
  "e.here": "here now",
  "e.pad": "Pad text",
  "e.ph": "Start typing…",
  "s.saved": "Saved",
  "s.saving": "Saving…",
  "s.offline": "Offline",
  "s.connecting": "Connecting…",
  "s.reconnecting": "Reconnecting…",
  "toast.copied": "Link copied",
  "toast.dl": "Downloaded",
  "toast.nocopy": "Copy is not available here. Select the text and copy it.",
  "sh.title": "Share this pad",
  "sh.sub": "Anyone with the address can read and edit.",
  "sh.copy": "Copy link",
  "sh.copied": "Copied",
  "sh.done": "Done",
  "sh.scan": "Point a phone camera at the code to open this pad there.",
  "sh.qr": "QR code for",
  "m.md": "Download as Markdown",
  "m.txt": "Download as text",
  "m.theme": "Theme",
  "m.lang": "Language",
  "th.system": "System",
  "th.light": "Light",
  "th.dark": "Dark",
  "st.offline.t": "Offline",
  "st.offline.b":
    "You are offline. Changes stay on this device and sync when you reconnect.",
  "st.full.t": "Pad is full",
  "st.full.b":
    "This pad reached its 1 MB limit. Delete some text to keep editing, or download a copy first.",
  "st.invalid.t": "Invalid address",
  "st.reserved.t": "Reserved address",
  "st.busy.t": "Pad is busy",
  "st.busy.b": `${MAX_CONNECTIONS} people are editing right now. Try again in a minute.`,
  "st.removed.t": "This pad was removed",
  "st.removed.b":
    "It broke the content policy. If you think this is a mistake, contact the operator.",
  "st.removed.cat": "It broke the content policy ({cat}) on {date}.",
  "st.error.t": "Something went wrong on our side",
  "st.error.b": "Your text is safe on this device. Try again in a moment.",
  "st.retry": "Try again",
  "cat.spam": "spam",
  "cat.scam": "scam",
  "cat.illegal": "illegal content",
  "cat.harassment": "harassment",
  "cat.personal": "personal data",
  "cat.other": "other",
  "ago.now": "just now",
  "l.report": "Report a pad",
  "l.about": "About",
  "ab.title": "About Padline",
  "ab.p1":
    "Padline is a plain notepad on the web. Open an address, type, and everyone on it sees it live. No account, no setup.",
  "ab.p2":
    "Pads are public. Anyone who knows an address can read and edit it, and the operator can see every pad. Use it for notes you are happy to share, not for secrets.",
  "ab.p3":
    "A pad holds up to 1 MB of text. Every pad you open is also kept on your device, so a dropped connection loses nothing and merges when you are back.",
  "ab.p4":
    "A pad that breaks the content policy can be reported. The operator can empty or remove it. Reports hold no pad text and no IP address.",
  "ab.src": "Source code",
  "m.report": "Report this pad",
  "r.title": "Report a pad",
  "r.sub": "Tell us which pad broke the content policy and why. We never need its text.",
  "r.pad": "Pad address",
  "r.cat": "Reason",
  "r.note": "Details (optional)",
  "r.note.hint": "Do not paste the pad's text here.",
  "r.contact": "Your email (optional)",
  "r.send": "Send report",
  "r.sending": "Sending",
  "r.err": "Could not send the report. Try again in a moment.",
  "r.err.pad": "Enter a valid pad address.",
  "r.done.t": "Report received",
  "r.done.b":
    "Thanks. An operator reviews reports by hand. We do not say whether a pad exists or what was decided.",
  "a.title": "Admin",
  "a.tag": "Behind Cloudflare Access",
  "a.f.recent": "Recent",
  "a.f.largest": "Largest",
  "a.f.active": "Active",
  "a.f.reported": "Reported",
  "a.search": "Search address",
  "a.col.pad": "Pad",
  "a.col.size": "Size",
  "a.col.last": "Last edit",
  "a.col.edits": "Edits",
  "a.none": "No pads match.",
  "a.select": "Select a pad.",
  "a.created": "Created",
  "a.noText": "No text.",
  "a.reports": "Reports",
  "a.nreports": "{n} reports",
  "a.blocked": "Blocked",
  "a.emptied": "Emptied",
  "a.open": "Open pad",
  "a.clear": "Delete content",
  "a.block": "Block",
  "a.blockPad": "Block pad",
  "a.dismiss": "Dismiss reports",
  "a.cancel": "Cancel",
  "a.cat": "Category",
  "a.confirm.clear": "Removes the text. The address stays open for anyone to use.",
  "a.confirm.block":
    "Blocks the address and removes the text. Visitors see a removed notice with the category and today's date.",
  "a.log": "Action log",
  "a.act.clear": "delete content",
  "a.act.block": "block",
  "a.act.dismiss": "dismiss reports",
  "a.err": "That did not go through. Reload to see what is in effect.",
  "a.denied": "Access denied.",
};

const pt: Table = {
  "l.h": "Abra um endereço. Comece a escrever.",
  "l.sub":
    "Um bloco compartilhado para qualquer coisa. Quem abre o mesmo endereço vê o mesmo texto, ao vivo. Sem conta, sem configuração.",
  "l.ph": "nome-do-bloco",
  "l.open": "Abrir",
  "l.opensas": "Vai abrir como",
  "l.err.invalid": "Use letras, números e hífens, até 64 caracteres.",
  "l.err.reserved": "Esse endereço é reservado. Tente outro.",
  "l.random": "Ou comece com um endereço aleatório",
  "l.shuffle": "Outro endereço aleatório",
  "l.recent": "Abertos recentemente neste aparelho",
  "l.note":
    "Os blocos são públicos. Quem souber o endereço pode ler e editar, e o operador enxerga todos os blocos.",
  "e.share": "Compartilhar",
  "e.preview": "Prévia",
  "e.edit": "Editar",
  "e.more": "Mais",
  "e.home": "Voltar ao início",
  "e.copyLink": "Copiar link",
  "e.words": "palavras",
  "e.you": "Você",
  "e.here": "aqui agora",
  "e.pad": "Texto do bloco",
  "e.ph": "Comece a escrever…",
  "s.saved": "Salvo",
  "s.saving": "Salvando…",
  "s.offline": "Sem conexão",
  "s.connecting": "Conectando…",
  "s.reconnecting": "Reconectando…",
  "toast.copied": "Link copiado",
  "toast.dl": "Baixado",
  "toast.nocopy": "Não foi possível copiar aqui. Selecione o texto e copie.",
  "sh.title": "Compartilhar este bloco",
  "sh.sub": "Quem tiver o endereço pode ler e editar.",
  "sh.copy": "Copiar link",
  "sh.copied": "Copiado",
  "sh.done": "Concluir",
  "sh.scan": "Aponte a câmera do celular para o código e abra este bloco lá.",
  "sh.qr": "Código QR de",
  "m.md": "Baixar como Markdown",
  "m.txt": "Baixar como texto",
  "m.theme": "Tema",
  "m.lang": "Idioma",
  "th.system": "Sistema",
  "th.light": "Claro",
  "th.dark": "Escuro",
  "st.offline.t": "Sem conexão",
  "st.offline.b":
    "Você está sem conexão. As mudanças ficam neste aparelho e sincronizam quando voltar.",
  "st.full.t": "Bloco cheio",
  "st.full.b":
    "Este bloco chegou ao limite de 1 MB. Apague um pouco de texto para continuar, ou baixe uma cópia antes.",
  "st.invalid.t": "Endereço inválido",
  "st.reserved.t": "Endereço reservado",
  "st.busy.t": "Bloco lotado",
  "st.busy.b": `${MAX_CONNECTIONS} pessoas estão editando agora. Tente de novo em um minuto.`,
  "st.removed.t": "Este bloco foi removido",
  "st.removed.b":
    "Ele violou a política de conteúdo. Se acha que foi um engano, fale com o operador.",
  "st.removed.cat": "Ele violou a política de conteúdo ({cat}) em {date}.",
  "st.error.t": "Algo deu errado do nosso lado",
  "st.error.b": "Seu texto está salvo neste aparelho. Tente de novo em instantes.",
  "st.retry": "Tentar de novo",
  "cat.spam": "spam",
  "cat.scam": "golpe",
  "cat.illegal": "conteúdo ilegal",
  "cat.harassment": "assédio",
  "cat.personal": "dados pessoais",
  "cat.other": "outro",
  "ago.now": "agora há pouco",
  "l.report": "Denunciar um bloco",
  "l.about": "Sobre",
  "ab.title": "Sobre o Padline",
  "ab.p1":
    "O Padline é um bloco de notas simples na web. Abra um endereço, escreva, e todos que estiverem nele veem ao vivo. Sem conta, sem configuração.",
  "ab.p2":
    "Os blocos são públicos. Quem souber o endereço pode ler e editar, e o operador pode ver todos os blocos. Use para anotações que você não se importa de compartilhar, não para segredos.",
  "ab.p3":
    "Um bloco guarda até 1 MB de texto. Cada bloco que você abre também fica salvo no seu aparelho, então uma queda de conexão não perde nada e tudo se junta quando você volta.",
  "ab.p4":
    "Um bloco que viole a política de conteúdo pode ser denunciado. O operador pode esvaziar ou remover o bloco. As denúncias não guardam o texto do bloco nem endereço de quem denunciou.",
  "ab.src": "Código-fonte",
  "m.report": "Denunciar este bloco",
  "r.title": "Denunciar um bloco",
  "r.sub": "Diga qual bloco violou a política de conteúdo e por quê. Não precisamos do texto.",
  "r.pad": "Endereço do bloco",
  "r.cat": "Motivo",
  "r.note": "Detalhes (opcional)",
  "r.note.hint": "Não cole o texto do bloco aqui.",
  "r.contact": "Seu e-mail (opcional)",
  "r.send": "Enviar denúncia",
  "r.sending": "Enviando",
  "r.err": "Não foi possível enviar a denúncia. Tente de novo em instantes.",
  "r.err.pad": "Informe um endereço de bloco válido.",
  "r.done.t": "Denúncia recebida",
  "r.done.b":
    "Obrigado. Um operador revisa as denúncias manualmente. Não informamos se o bloco existe nem o que foi decidido.",
  "a.title": "Admin",
  "a.tag": "Atrás do Cloudflare Access",
  "a.f.recent": "Recentes",
  "a.f.largest": "Maiores",
  "a.f.active": "Ativos",
  "a.f.reported": "Denunciados",
  "a.search": "Buscar endereço",
  "a.col.pad": "Bloco",
  "a.col.size": "Tamanho",
  "a.col.last": "Última edição",
  "a.col.edits": "Edições",
  "a.none": "Nenhum bloco encontrado.",
  "a.select": "Selecione um bloco.",
  "a.created": "Criado",
  "a.noText": "Sem texto.",
  "a.reports": "Denúncias",
  "a.nreports": "{n} denúncias",
  "a.blocked": "Bloqueado",
  "a.emptied": "Esvaziado",
  "a.open": "Abrir bloco",
  "a.clear": "Apagar conteúdo",
  "a.block": "Bloquear",
  "a.blockPad": "Bloquear bloco",
  "a.dismiss": "Descartar denúncias",
  "a.cancel": "Cancelar",
  "a.cat": "Categoria",
  "a.confirm.clear": "Remove o texto. O endereço continua livre para qualquer pessoa usar.",
  "a.confirm.block":
    "Bloqueia o endereço e remove o texto. Quem visitar vê o aviso de removido com a categoria e a data de hoje.",
  "a.log": "Registro de ações",
  "a.act.clear": "apagar conteúdo",
  "a.act.block": "bloquear",
  "a.act.dismiss": "descartar denúncias",
  "a.err": "Não deu certo. Recarregue para ver o que está valendo.",
  "a.denied": "Acesso negado.",
};

const tables: Record<Lang, Table> = { en, pt };

export function t(key: string, vars?: Record<string, string>): string {
  let s = tables[getLang()][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

/** Fills every [data-i18n], [data-i18n-ph] and [data-i18n-aria] under `root`. */
export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  });
  document.documentElement.lang = getLang() === "pt" ? "pt-BR" : "en";
}

/** "2 min ago", "yesterday", "3 days ago", in the visitor's language. */
export function ago(at: number, now = Date.now()): string {
  const secs = Math.round((at - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(getLang() === "pt" ? "pt-BR" : "en", {
    numeric: "auto",
  });
  const abs = Math.abs(secs);
  if (abs < 60) return t("ago.now");
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  return rtf.format(Math.round(secs / 86400), "day");
}

export function formatDate(at: number): string {
  return new Intl.DateTimeFormat(getLang() === "pt" ? "pt-BR" : "en", {
    dateStyle: "medium",
  }).format(at);
}
