/**
 * Small browser entry point. Editor runtime and parser implementations are
 * fetched only when a matching editor appears or a parser API is called.
 */

import "./index.css";
import * as lengthEditorDetails from "./editors/utilities/lengthEditorDetails.js";
import observer from "@cocreate/observer";
import { queryElements } from "@cocreate/utils";

const editorSelector = ":is([editor], [contenteditable], input[crdt='true'], textarea[crdt='true']):not([contenteditable='false']):not([editor-query])";
const bindingSelector = "[editor-query], [editor-attribute], [editor-property]";
const activationSelector = `${editorSelector}, ${bindingSelector}`;
const languageSelector = "code[language]";
const parserLoaders = {
    dom: () => import(/* webpackChunkName: "editor-parser-dom" */ "./editors/parsers/dom.js"),
    markdown: () => import(/* webpackChunkName: "editor-parser-markdown" */ "./editors/parsers/markdown.js"),
    code: () => import(/* webpackChunkName: "editor-parser-code" */ "./editors/parsers/code.js")
};

let runtimePromise;
let runtimeModule;
let inputBindingPromise;
const parserPromises = new Map();
const languageStates = new WeakMap();

function codeNodeFor(element) {
    if (element.matches?.("code")) return element;
    return null;
}

function isEditorTarget(element) {
    return !!element.closest?.(editorSelector);
}

function clearLanguage(element) {
    const code = codeNodeFor(element);
    const state = code && languageStates.get(code);
    if (!code || !state) return;
    languageStates.delete(code);
    code.replaceChildren(code.ownerDocument.createTextNode(code.textContent || ""));
}

function languageError(element, error) {
    const EventConstructor = element.ownerDocument?.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (EventConstructor) element.dispatchEvent(new EventConstructor("language-error", {
        bubbles: true, detail: { error }
    }));
}

async function formatLanguage(element) {
    if (isEditorTarget(element)) return;
    const language = element.getAttribute("language")?.trim();
    const code = codeNodeFor(element);
    if (!language || !code) return;

    const source = code.textContent || "";
    const previous = languageStates.get(code);
    if (previous?.language === language && previous.source === source) return previous.promise;

    const state = { language, source, promise: null };
    languageStates.set(code, state);
    state.promise = (async () => {
        const parser = await loadParser("code");
        const details = await parser.parseCode(source, language);
        if (languageStates.get(code) !== state ||
            element.getAttribute("language") !== language || code.textContent !== source) return;

        const fragment = code.ownerDocument.createDocumentFragment();
        for (const detail of details) {
            if (detail.token) {
                const span = code.ownerDocument.createElement("span");
                span.className = `token-${detail.token}`;
                span.textContent = detail.value;
                fragment.append(span);
            } else fragment.append(code.ownerDocument.createTextNode(detail.value));
        }
        code.replaceChildren(fragment);
    })().catch(error => {
        if (languageStates.get(code) === state) languageStates.delete(code);
        languageError(element, error);
    });
    return state.promise;
}

/**
 *
 * @public
 * @environment client
 */
export async function initLanguage(root = globalThis.document) {
    if (!root) return [];
    const elements = new Set();
    if (root.matches?.(languageSelector) && !isEditorTarget(root)) elements.add(root);
    for (const element of queryElements({ element: root, selector: languageSelector }))
        if (!isEditorTarget(element)) elements.add(element);
    return Promise.all([...elements].map(formatLanguage));
}

function loadRuntime() {
    runtimePromise ||= import(/* webpackChunkName: "editor-runtime" */ "./core.js")
        .then(module => { runtimeModule = module; return module; })
        .catch(error => { runtimePromise = undefined; throw error; });
    return runtimePromise;
}

function loadInputBinding() {
    inputBindingPromise ||= import(/* webpackChunkName: "editor-input-binding" */ "./inputBinding.js")
        .catch(error => { inputBindingPromise = undefined; throw error; });
    return inputBindingPromise;
}

/**
 *
 * @public
 * @environment client
 */
export function loadParser(type) {
    const loader = parserLoaders[type];
    if (!loader) return Promise.reject(new TypeError(`Unknown editor parser: ${type}`));
    if (!parserPromises.has(type)) {
        parserPromises.set(type, loader().catch(error => {
            parserPromises.delete(type);
            throw error;
        }));
    }
    return parserPromises.get(type);
}

function callRuntime(name, args) {
    return loadRuntime().then(module => {
        const method = module.default?.[name] || module[name];
        if (typeof method !== "function") throw new TypeError(`Unknown editor API: ${name}`);
        return method(...args);
    });
}

/**
 *
 * @public
 * @environment client
 */
export const parseDOM = async source => (await loadParser("dom")).default(source);
/**
 *
 * @public
 * @environment client
 */
export const parseMarkdown = async source => (await loadParser("markdown")).default(source);
/**
 *
 * @public
 * @environment client
 */
export const parseCode = async (source, language) => (await loadParser("code")).parseCode(source, language);
/**
 *
 * @public
 * @environment client
 */
export const autoLanguageDetection = async source => (await loadParser("code")).autoLanguageDetection(source);

/**
 *
 * @public
 * @environment client
 */
export async function init(root = globalThis.document) {
    const editors = await callRuntime("init", [root]);
    if (root?.matches?.(bindingSelector) || root?.querySelector?.(bindingSelector))
        await (await loadInputBinding()).init(root);
    await initLanguage(root);
    return editors;
}
/**
 *
 * @public
 * @environment client
 */
export const initElements = (...args) => callRuntime("initElements", args);
/**
 *
 * @public
 * @environment client
 */
export const initElement = (...args) => callRuntime("initElement", args);
/**
 *
 * @public
 * @environment client
 */
export const createEditorCore = (...args) => callRuntime("createEditorCore", args);
/**
 *
 * @public
 * @environment client
 */
export const createCore = createEditorCore;
/**
 *
 * @public
 * @environment client
 */
export const createEditorEvents = (...args) => callRuntime("createEditorEvents", args);
/**
 *
 * @public
 * @environment client
 */
export const bindEditorInput = (...args) => callRuntime("bindEditorInput", args);
/**
 *
 * @public
 * @environment client
 */
export const getSelection = (...args) => callRuntime("getSelection", args);
/**
 *
 * @public
 * @environment client
 */
export const setSelection = (...args) => callRuntime("setSelection", args);
/**
 *
 * @public
 * @environment client
 */
export const textChange = (...args) => callRuntime("textChange", args);
/**
 *
 * @public
 * @environment client
 */
export const initEditorInput = (...args) => callRuntime("initEditorInput", args);
/**
 *
 * @public
 * @environment client
 */
export const uninitEditorInput = (...args) => callRuntime("uninitEditorInput", args);
/**
 *
 * @public
 * @environment client
 */
export const initEditorQuery = (...args) => callRuntime("initEditorQuery", args);
/**
 *
 * @public
 * @environment client
 */
export const uninitEditorQuery = (...args) => callRuntime("uninitEditorQuery", args);
/**
 *
 * @public
 * @environment client
 */
export const destroyEditor = (...args) => callRuntime("destroyEditor", args);
/**
 *
 * @public
 * @environment client
 */
export const sendPosition = (...args) => callRuntime("sendPosition", args);
/**
 *
 * @public
 * @environment client
 */
export const updateText = (...args) => callRuntime("updateText", args);
/**
 *
 * @public
 * @environment client
 */
export const updateElement = (...args) => callRuntime("updateElement", args);
/**
 *
 * @public
 * @environment client
 */
export const loadEditor = (...args) => callRuntime("loadEditor", args);
/**
 *
 * @public
 * @environment client
 */
export const createTextEditor = (...args) => callRuntime("createTextEditor", args);
/**
 *
 * @public
 * @environment client
 */
export const createDOMEditor = (...args) => callRuntime("createDOMEditor", args);
/**
 *
 * @public
 * @environment client
 */
export const createMarkdownEditor = (...args) => callRuntime("createMarkdownEditor", args);
/**
 *
 * @public
 * @environment client
 */
export const createCodeEditor = (...args) => callRuntime("createCodeEditor", args);
/**
 *
 * @public
 * @environment client
 */
export const parseAndStoreEditorDetails = (...args) => callRuntime("parseAndStoreEditorDetails", args);
/**
 *
 * @public
 * @environment client
 */
export const parseAndStoreMarkdownDetails = (...args) => callRuntime("parseAndStoreMarkdownDetails", args);
/**
 *
 * @public
 * @environment client
 */
export const parseAndStoreCodeDetails = (...args) => callRuntime("parseAndStoreCodeDetails", args);
/**
 *
 * @public
 * @environment client
 */
export const updateStoredEditorDetails = (...args) => callRuntime("updateStoredEditorDetails", args);
/**
 *
 * @public
 * @environment client
 */
export const getStoredEditorDetails = editor => runtimeModule?.default?.getStoredEditorDetails?.(editor);
/**
 *
 * @public
 * @environment client
 */
export const deleteStoredEditorDetails = (...args) => callRuntime("deleteStoredEditorDetails", args);
/**
 *
 * @public
 * @environment client
 */
export { lengthEditorDetails };

function reportError(element, error) {
    const EventConstructor = element.ownerDocument?.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (EventConstructor) element.dispatchEvent(new EventConstructor("editor-error", {
        bubbles: true, detail: { error }
    }));
}

function activate(node) {
    const activateElement = element => {
        if (element.matches(editorSelector))
            loadRuntime().catch(error => reportError(element, error));
        if (element.matches(bindingSelector))
            loadInputBinding().catch(error => reportError(element, error));
    };
    if (node?.nodeType === 1) activateElement(node);
    node?.querySelectorAll?.(activationSelector).forEach(activateElement);
}

function observeDocument() {
    if (typeof document === "undefined" || !document.documentElement) return;
    activate(document.documentElement);
    const Observer = document.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(records => {
        for (const record of records) {
            if (record.type === "attributes") activate(record.target);
            else for (const node of record.addedNodes) activate(node);
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["editor", "contenteditable", "editor-query",
            "editor-attribute", "editor-property", "crdt"]
    });
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", observeDocument, { once: true });
    else queueMicrotask(observeDocument);
}

const editor = {
    init, initElements, initElement, initLanguage, createEditorCore, createCore, createEditorEvents,
    bindEditorInput, getSelection, setSelection, textChange,
    initEditorInput, uninitEditorInput, initEditorQuery, uninitEditorQuery, destroyEditor,
    sendPosition, updateText, updateElement, loadEditor, loadParser, parseDOM,
    parseMarkdown, parseCode, autoLanguageDetection, createTextEditor, createDOMEditor,
    createMarkdownEditor, createCodeEditor, parseAndStoreEditorDetails,
    parseAndStoreMarkdownDetails, parseAndStoreCodeDetails, updateStoredEditorDetails,
    getStoredEditorDetails, deleteStoredEditorDetails, lengthEditorDetails
};

observer.init([
    {
        name: "CoCreateLanguageAddedNodes",
        types: ["addedNodes", "childList", "characterData"],
        selector: languageSelector,
        callback: mutation => { void initLanguage(mutation.target); }
    },
    {
        name: "CoCreateLanguageAttribute",
        types: ["attributes"],
        attributeFilter: ["language"],
        selector: "code",
        callback: mutation => {
            if (mutation.target.hasAttribute("language"))
                void initLanguage(mutation.target);
            else clearLanguage(mutation.target);
        }
    }
]);

if (typeof document !== "undefined")
    void initLanguage(document).catch(error => console.error("CoCreate language formatting failed", error));

export default editor;

/**
 *
 * @name contenteditable
 * @kind attribute
 * @environment client
 */

/**
 *
 * @name crdt
 * @kind attribute
 * @environment client
 */

/**
 *
 * @name editor
 * @kind attribute
 * @environment client
 */

/**
 *
 * @name editor-attribute
 * @kind attribute
 * @environment client
 */

/**
 *
 * @name editor-property
 * @kind attribute
 * @environment client
 */

/**
 *
 * @name editor-query
 * @kind attribute
 * @environment client
 */

/**
 *
 * @name language
 * @kind attribute
 * @environment client
 */

/**
 * Extensible collaborative editor for text, HTML/DOM, Markdown, and code with syntax highlighting and optional CRDT sync.
 *
 * @module editor
 * @environment client
 */

/**
 * Declarative selectors recognized by this module.
 *
 * @name declarative-selectors
 * @kind member
 * @selectors
 * @environment client
 * @example
 * ```json
 * [
 *   "code",
 *   ":is([editor], [contenteditable], input[crdt='true'], textarea[crdt='true']):not([contenteditable='false']):not([editor-query])",
 *   "[editor-query], [editor-attribute], [editor-property]",
 *   "${editorSelector}, ${bindingSelector}",
 *   "code[language]"
 * ]
 * ```
 */
