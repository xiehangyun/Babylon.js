/* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
/* eslint-disable github/no-then */
/* eslint-disable @typescript-eslint/naming-convention */
import { Observable } from "core/Misc/observable";
import { Tools } from "core/Misc/tools";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { isUrl, camelToKebab, kebabToCamel, deepmerge } from "../helper/index";

import * as Handlebars from "handlebars";
import { EventManager } from "./eventManager";
import type { ITemplateConfiguration } from "../configuration/interfaces/templateConfiguration";
import type { IFileRequest } from "core/Misc/fileRequest";

/**
 * The object sent when an event is triggered
 */
export interface EventCallback {
    event: Event;
    template: Template;
    selector: string;
    payload?: any;
}

/**
 * The template manager, a member of the viewer class, will manage the viewer's templates and generate the HTML.
 * The template manager managers a single viewer and can be seen as the collection of all sub-templates of the viewer.
 */
export class TemplateManager {
    /**
     * Will be triggered when any template is initialized
     */
    public onTemplateInit: Observable<Template>;
    /**
     * Will be triggered when any template is fully loaded
     */
    public onTemplateLoaded: Observable<Template>;
    /**
     * Will be triggered when a template state changes
     */
    public onTemplateStateChange: Observable<Template>;
    /**
     * Will be triggered when all templates finished loading
     */
    public onAllLoaded: Observable<TemplateManager>;
    /**
     * Will be triggered when any event on any template is triggered.
     */
    public onEventTriggered: Observable<EventCallback>;

    /**
     * This template manager's event manager. In charge of callback registrations to native event types
     */
    public eventManager: EventManager;

    private _templates: { [name: string]: Template };

    constructor(public containerElement: Element) {
        this._templates = {};

        this.onTemplateInit = new Observable<Template>();
        this.onTemplateLoaded = new Observable<Template>();
        this.onTemplateStateChange = new Observable<Template>();
        this.onAllLoaded = new Observable<TemplateManager>();
        this.onEventTriggered = new Observable<EventCallback>();

        this.eventManager = new EventManager(this);
    }

    /**
     * Initialize the template(s) for the viewer. Called bay the Viewer class
     * @param templates the templates to be used to initialize the main template
     * @returns a promise that will be fulfilled when the template is loaded
     */
    public async initTemplate(templates: { [key: string]: ITemplateConfiguration }) {
        const internalInit = (dependencyMap: any, name: string, parentTemplate?: Template) => {
            //init template
            const template = this._templates[name];

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            Object.keys(dependencyMap).map((childName) => {
                return internalInit(dependencyMap[childName], childName, template);
            });

            // register the observers
            //template.onLoaded.add(() => {
            const addToParent = () => {
                const lastElements = parentTemplate && parentTemplate.parent.querySelectorAll(camelToKebab(name) as keyof HTMLElementTagNameMap);
                const containingElement = (lastElements && lastElements.length && lastElements.item(lastElements.length - 1)) || this.containerElement;
                template.appendTo(<HTMLElement>containingElement);
                this._checkLoadedState();
            };

            if (parentTemplate && !parentTemplate.parent) {
                parentTemplate.onAppended.add(() => {
                    addToParent();
                });
            } else {
                addToParent();
            }
            //});

            return template;
        };

        //build the html tree
        return await this._buildHTMLTree(templates).then((htmlTree) => {
            if (this._templates["main"]) {
                internalInit(htmlTree, "main");
            } else {
                this._checkLoadedState();
            }
            return;
        });
    }

    /**
     *
     * This function will create a simple map with child-dependencies of the template html tree.
     * It will compile each template, check if its children exist in the configuration and will add them if they do.
     * It is expected that the main template will be called main!
     *
     * @param templates the templates to be used to initialize the main template
     * @returns a promise that will be fulfilled when the template is loaded
     */
    private async _buildHTMLTree(templates: { [key: string]: ITemplateConfiguration }): Promise<object> {
        const promises: Array<Promise<Template | boolean>> = Object.keys(templates).map(async (name) => {
            // if the template was overridden
            if (!templates[name]) {
                return await Promise.resolve(false);
            }
            // else - we have a template, let's do our job!
            const template = new Template(name, templates[name]);
            template.onLoaded.add(() => {
                this.onTemplateLoaded.notifyObservers(template);
            });
            template.onStateChange.add(() => {
                this.onTemplateStateChange.notifyObservers(template);
            });
            this.onTemplateInit.notifyObservers(template);
            // make sure the global onEventTriggered is called as well
            template.onEventTriggered.add((eventData) => this.onEventTriggered.notifyObservers(eventData));
            this._templates[name] = template;
            return await template.initPromise;
        });

        return await Promise.all(promises).then(() => {
            const templateStructure = {};
            // now iterate through all templates and check for children:
            const buildTree = (parentObject: any, name: string) => {
                this._templates[name].isInHtmlTree = true;
                const childNodes = this._templates[name].getChildElements().filter((n) => !!this._templates[n]);
                childNodes.forEach((element) => {
                    parentObject[element] = {};
                    buildTree(parentObject[element], element);
                });
            };
            if (this._templates["main"]) {
                buildTree(templateStructure, "main");
            }
            return templateStructure;
        });
    }

    /**
     * Get the canvas in the template tree.
     * There must be one and only one canvas inthe template.
     * @returns the canvas element or null if not found
     */
    public getCanvas(): HTMLCanvasElement | null {
        return this.containerElement.querySelector("canvas");
    }

    /**
     * Get a specific template from the template tree
     * @param name the name of the template to load
     * @returns the template or undefined if not found
     */
    public getTemplate(name: string): Template | undefined {
        return this._templates[name];
    }

    private _checkLoadedState() {
        const done =
            Object.keys(this._templates).length === 0 ||
            Object.keys(this._templates).every((key) => {
                return (this._templates[key].isLoaded && !!this._templates[key].parent) || !this._templates[key].isInHtmlTree;
            });

        if (done) {
            this.onAllLoaded.notifyObservers(this);
        }
    }

    /**
     * Dispose the template manager
     */
    public dispose() {
        // dispose all templates
        Object.keys(this._templates).forEach((template) => {
            this._templates[template].dispose();
        });
        this._templates = {};
        this.eventManager.dispose();

        this.onTemplateInit.clear();
        this.onAllLoaded.clear();
        this.onEventTriggered.clear();
        this.onTemplateLoaded.clear();
        this.onTemplateStateChange.clear();
    }
}

// register a new helper. modified https://stackoverflow.com/questions/9838925/is-there-any-method-to-iterate-a-map-with-handlebars-js
Handlebars.registerHelper("eachInMap", function (map, block) {
    let out = "";
    Object.keys(map).map(function (prop) {
        const data = map[prop];
        if (typeof data === "object") {
            data.id = data.id || prop;
            out += block.fn(data);
        } else {
            out += block.fn({ id: prop, value: data });
        }
    });
    return out;
});

Handlebars.registerHelper("add", function (a, b) {
    const out = a + b;
    return out;
});

Handlebars.registerHelper("eq", function (a, b) {
    const out = a == b;
    return out;
});

Handlebars.registerHelper("or", function (a, b) {
    const out = a || b;
    return out;
});

Handlebars.registerHelper("not", function (a) {
    const out = !a;
    return out;
});

Handlebars.registerHelper("count", function (map) {
    return map.length;
});

Handlebars.registerHelper("gt", function (a, b) {
    const out = a > b;
    return out;
});

/**
 * This class represents a single template in the viewer's template tree.
 * An example for a template is a single canvas, an overlay (containing sub-templates) or the navigation bar.
 * A template is injected using the template manager in the correct position.
 * The template is rendered using Handlebars and can use Handlebars' features (such as parameter injection)
 *
 * For further information please refer to the documentation page, https://doc.babylonjs.com
 */
export class Template {
    /**
     * Will be triggered when the template is loaded
     */
    public onLoaded: Observable<Template>;
    /**
     * will be triggered when the template is appended to the tree
     */
    public onAppended: Observable<Template>;
    /**
     * Will be triggered when the template's state changed (shown, hidden)
     */
    public onStateChange: Observable<Template>;
    /**
     * Will be triggered when an event is triggered on ths template.
     * The event is a native browser event (like mouse or pointer events)
     */
    public onEventTriggered: Observable<EventCallback>;

    public onParamsUpdated: Observable<Template>;

    public onHTMLRendered: Observable<Template>;

    /**
     * is the template loaded?
     */
    public isLoaded: boolean;
    /**
     * This is meant to be used to track the show and hide functions.
     * This is NOT (!!) a flag to check if the element is actually visible to the user.
     */
    public isShown: boolean;

    /**
     * Is this template a part of the HTML tree (the template manager injected it)
     */
    public isInHtmlTree: boolean;

    /**
     * The HTML element containing this template
     */
    public parent: HTMLElement;

    /**
     * A promise that is fulfilled when the template finished loading.
     */
    public initPromise: Promise<Template>;

    private _fragment: DocumentFragment | Element;
    private _addedFragment: DocumentFragment | Element;
    private _htmlTemplate: string;
    private _rawHtml: string;

    private _loadRequests: Array<IFileRequest>;

    constructor(
        public name: string,
        private _configuration: ITemplateConfiguration
    ) {
        this.onLoaded = new Observable<Template>();
        this.onAppended = new Observable<Template>();
        this.onStateChange = new Observable<Template>();
        this.onEventTriggered = new Observable<EventCallback>();
        this.onParamsUpdated = new Observable<Template>();
        this.onHTMLRendered = new Observable<Template>();

        this._loadRequests = [];

        this.isLoaded = false;
        this.isShown = false;
        this.isInHtmlTree = false;

        const htmlContentPromise = this._getTemplateAsHtml(_configuration);

        this.initPromise = htmlContentPromise.then((htmlTemplate) => {
            if (htmlTemplate) {
                this._htmlTemplate = htmlTemplate;
                const compiledTemplate = Handlebars.compile(htmlTemplate, { noEscape: this._configuration.params && !!this._configuration.params.noEscape });
                const config = this._configuration.params || {};
                this._rawHtml = compiledTemplate(config);
                try {
                    this._fragment = document.createRange().createContextualFragment(this._rawHtml);
                } catch (e) {
                    const test = document.createElement(this.name);
                    test.innerHTML = this._rawHtml;
                    this._fragment = test;
                }
                this.isLoaded = true;
                this.isShown = true;
                this.onLoaded.notifyObservers(this);
            }
            return this;
        });
    }

    /**
     * Some templates have parameters (like background color for example).
     * The parameters are provided to Handlebars which in turn generates the template.
     * This function will update the template with the new parameters
     *
     * Note that when updating parameters the events will be registered again (after being cleared).
     *
     * @param params the new template parameters
     * @param append
     */
    public updateParams(params: { [key: string]: string | number | boolean | object }, append: boolean = true) {
        if (append) {
            this._configuration.params = deepmerge(this._configuration.params, params);
        } else {
            this._configuration.params = params;
        }
        // update the template
        if (this.isLoaded) {
            // this.dispose();
        }
        const compiledTemplate = Handlebars.compile(this._htmlTemplate);
        const config = this._configuration.params || {};
        this._rawHtml = compiledTemplate(config);
        try {
            this._fragment = document.createRange().createContextualFragment(this._rawHtml);
        } catch (e) {
            const test = document.createElement(this.name);
            test.innerHTML = this._rawHtml;
            this._fragment = test;
        }
        if (this.parent) {
            this.appendTo(this.parent, true);
        }
    }

    public redraw() {
        this.updateParams({});
    }

    /**
     * Get the template'S configuration
     */
    public get configuration(): ITemplateConfiguration {
        return this._configuration;
    }

    /**
     * A template can be a parent element for other templates or HTML elements.
     * This function will deliver all child HTML elements of this template.
     * @returns an array of strings, each string is the name of the child element
     */
    public getChildElements(): Array<string> {
        const childrenArray: string[] = [];
        //Edge and IE don't support frage,ent.children
        let children: HTMLCollection | NodeListOf<Element> = this._fragment && this._fragment.children;
        if (!this._fragment) {
            const fragment = this.parent.querySelector(this.name);
            if (fragment) {
                children = fragment.querySelectorAll("*");
            }
        }
        if (!children) {
            // casting to HTMLCollection, as both NodeListOf and HTMLCollection have 'item()' and 'length'.
            children = this._fragment.querySelectorAll("*");
        }
        for (let i = 0; i < children.length; ++i) {
            const child = children.item(i);
            if (child) {
                childrenArray.push(kebabToCamel(child.nodeName.toLowerCase()));
            }
        }
        return childrenArray;
    }

    /**
     * Appending the template to a parent HTML element.
     * If a parent is already set and you wish to replace the old HTML with new one, forceRemove should be true.
     * @param parent the parent to which the template is added
     * @param forceRemove if the parent already exists, shoud the template be removed from it?
     */
    public appendTo(parent: HTMLElement, forceRemove?: boolean) {
        if (this.parent) {
            if (forceRemove && this._addedFragment) {
                /*let fragement = this.parent.querySelector(this.name)
                if (fragement)
                    this.parent.removeChild(fragement);*/
                this.parent.innerHTML = "";
            } else {
                return;
            }
        }
        this.parent = parent;

        if (this._configuration.id) {
            this.parent.id = this._configuration.id;
        }
        if (this._fragment) {
            this.parent.appendChild(this._fragment);
            this._addedFragment = this._fragment;
        } else {
            this.parent.insertAdjacentHTML("beforeend", this._rawHtml);
        }

        this.onHTMLRendered.notifyObservers(this);

        // appended only one frame after.
        setTimeout(() => {
            this._registerEvents();
            this.onAppended.notifyObservers(this);
        });
    }

    private _isShowing: boolean;
    private _isHiding: boolean;

    /**
     * Show the template using the provided visibilityFunction, or natively using display: flex.
     * The provided function returns a promise that should be fulfilled when the element is shown.
     * Since it is a promise async operations are more than possible.
     * See the default viewer for an opacity example.
     * @param visibilityFunction The function to execute to show the template.
     * @returns a promise that will be fulfilled when the template is shown
     */
    public async show(visibilityFunction?: (template: Template) => Promise<Template>): Promise<Template> {
        if (this._isHiding) {
            return await Promise.resolve(this);
        }
        return await Promise.resolve()
            .then(async () => {
                this._isShowing = true;
                if (visibilityFunction) {
                    return await visibilityFunction(this);
                } else {
                    // flex? box? should this be configurable easier than the visibilityFunction?
                    this.parent.style.display = "flex";
                    // support old browsers with no flex:
                    if (this.parent.style.display !== "flex") {
                        this.parent.style.display = "";
                    }
                    return this;
                }
            })
            .then(() => {
                this.isShown = true;
                this._isShowing = false;
                this.onStateChange.notifyObservers(this);
                return this;
            });
    }

    /**
     * Hide the template using the provided visibilityFunction, or natively using display: none.
     * The provided function returns a promise that should be fulfilled when the element is hidden.
     * Since it is a promise async operations are more than possible.
     * See the default viewer for an opacity example.
     * @param visibilityFunction The function to execute to show the template.
     * @returns a promise that will be fulfilled when the template is hidden
     */
    public async hide(visibilityFunction?: (template: Template) => Promise<Template>): Promise<Template> {
        if (this._isShowing) {
            return await Promise.resolve(this);
        }
        return await Promise.resolve()
            .then(async () => {
                this._isHiding = true;
                if (visibilityFunction) {
                    return await visibilityFunction(this);
                } else {
                    // flex? box? should this be configurable easier than the visibilityFunction?
                    this.parent.style.display = "none";
                    return this;
                }
            })
            .then(() => {
                this.isShown = false;
                this._isHiding = false;
                this.onStateChange.notifyObservers(this);
                return this;
            });
    }

    /**
     * Dispose this template
     */
    public dispose() {
        this.onAppended.clear();
        this.onEventTriggered.clear();
        this.onLoaded.clear();
        this.onStateChange.clear();
        this.isLoaded = false;
        // remove from parent
        try {
            this.parent.removeChild(this._fragment);
        } catch (e) {
            //noop
        }

        this._loadRequests.forEach((request) => {
            request.abort();
        });

        if (this._registeredEvents) {
            this._registeredEvents.forEach((evt) => {
                evt.htmlElement.removeEventListener(evt.eventName, evt.function);
            });
        }
    }

    private async _getTemplateAsHtml(templateConfig: ITemplateConfiguration): Promise<string> {
        if (!templateConfig) {
            return await Promise.reject("No templateConfig provided");
        } else if (templateConfig.html && !templateConfig.location) {
            return await Promise.resolve(templateConfig.html);
        } else {
            let location = this._getTemplateLocation(templateConfig);
            if (isUrl(location)) {
                return await new Promise((resolve, reject) => {
                    const fileRequest = Tools.LoadFile(
                        location,
                        (data: string | ArrayBuffer) => {
                            resolve(data as string);
                        },
                        undefined,
                        undefined,
                        false,
                        (request, error: any) => {
                            reject(error);
                        }
                    );
                    this._loadRequests.push(fileRequest);
                });
            } else {
                location = location.replace("#", "");
                const element = document.getElementById(location);
                if (element) {
                    return await Promise.resolve(element.innerHTML);
                } else {
                    return await Promise.reject("Template ID not found");
                }
            }
        }
    }

    private _registeredEvents: Array<{ htmlElement: HTMLElement; eventName: string; function: EventListenerOrEventListenerObject }>;

    private _registerEvents() {
        this._registeredEvents = this._registeredEvents || [];
        if (this._registeredEvents.length) {
            // first remove the registered events
            this._registeredEvents.forEach((evt) => {
                evt.htmlElement.removeEventListener(evt.eventName, evt.function);
            });
        }
        if (this._configuration.events) {
            for (const eventName in this._configuration.events) {
                if (this._configuration.events && this._configuration.events[eventName]) {
                    const functionToFire = (selector: string, event: Event) => {
                        this.onEventTriggered.notifyObservers({ event, template: this, selector });
                    };

                    // if boolean, set the parent as the event listener
                    if (typeof this._configuration.events[eventName] === "boolean") {
                        let selector = this.parent.id;
                        if (selector) {
                            selector = "#" + selector;
                        } else {
                            selector = this.parent.tagName;
                        }
                        const binding = functionToFire.bind(this, selector);
                        this.parent.addEventListener(eventName, binding, false);
                        this._registeredEvents.push({
                            htmlElement: this.parent,
                            eventName: eventName,
                            function: binding,
                        });
                    } else if (typeof this._configuration.events[eventName] === "object") {
                        const selectorsArray: Array<string> = Object.keys((this._configuration.events[eventName] as object) || {});
                        // strict null check is working incorrectly, must override:
                        const event = this._configuration.events[eventName] || {};
                        selectorsArray
                            .filter((selector) => typeof event !== "boolean" && event[selector])
                            .forEach((selector) => {
                                let htmlElement = <HTMLElement>this.parent.querySelector(selector);
                                if (!htmlElement) {
                                    // backcompat, fallback to id
                                    if (selector && selector.indexOf("#") !== 0) {
                                        selector = "#" + selector;
                                    }
                                    try {
                                        htmlElement = <HTMLElement>this.parent.querySelector(selector);
                                    } catch (e) {}
                                }
                                if (htmlElement) {
                                    const binding = functionToFire.bind(this, selector);
                                    htmlElement.addEventListener(eventName, binding, false);
                                    this._registeredEvents.push({
                                        htmlElement: htmlElement,
                                        eventName: eventName,
                                        function: binding,
                                    });
                                }
                            });
                    }
                }
            }
        }
    }

    private _getTemplateLocation(templateConfig: ITemplateConfiguration): string {
        if (!templateConfig || typeof templateConfig === "string") {
            return templateConfig;
        } else {
            return templateConfig.location!;
        }
    }
}
