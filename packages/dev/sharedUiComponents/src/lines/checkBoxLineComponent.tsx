import * as React from "react";
import type { Observable } from "core/Misc/observable";
import type { PropertyChangedEvent } from "./../propertyChangedEvent";
import { copyCommandToClipboard, getClassNameWithNamespace } from "../copyCommandToClipboard";
import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { conflictingValuesPlaceholder } from "./targetsProxy";
import copyIcon from "../imgs/copy.svg";
import { ToolContext } from "../fluent/hoc/fluentToolWrapper";
import { SwitchPropertyLine } from "../fluent/hoc/propertyLines/switchPropertyLine";
import { Checkbox } from "../fluent/primitives/checkbox";

export interface ICheckBoxLineComponentProps {
    label?: string;
    target?: any;
    propertyName?: string;
    isSelected?: boolean | (() => boolean);
    onSelect?: (value: boolean) => void;
    onValueChanged?: () => void;
    onPropertyChangedObservable?: Observable<PropertyChangedEvent>;
    disabled?: boolean;
    icon?: string;
    iconLabel?: string;
    faIcons?: { enabled: IconDefinition; disabled: IconDefinition };
    large?: boolean;
}

import toggleOnIcon40px from "../imgs/toggleOnIcon_40px.svg";
import toggleOffIcon40px from "../imgs/toggleOffIcon_40px.svg";
import toggleOnIcon30px from "../imgs/toggleOnIcon_30px.svg";
import toggleMixedIcon30px from "../imgs/toggleMixedIcon_30px.svg";
import toggleOffIcon30px from "../imgs/toggleOffIcon_30px.svg";

const Icons = {
    size30: {
        on: toggleOnIcon30px,
        mixed: toggleMixedIcon30px,
        off: toggleOffIcon30px,
    },
    size40: {
        on: toggleOnIcon40px,
        mixed: "", // unneeded
        off: toggleOffIcon40px,
    },
};

export class CheckBoxLineComponent extends React.Component<ICheckBoxLineComponentProps, { isSelected: boolean; isDisabled?: boolean; isConflict: boolean }> {
    private _localChange = false;
    constructor(props: ICheckBoxLineComponentProps) {
        super(props);

        if (this.props.isSelected !== undefined) {
            this.state = {
                isSelected: typeof this.props.isSelected === "boolean" ? this.props.isSelected : this.props.isSelected(),
                isConflict: false,
            };
        } else {
            this.state = {
                isSelected: this.props.target[this.props.propertyName!] === true,
                isConflict: this.props.target[this.props.propertyName!] === conflictingValuesPlaceholder,
            };
        }

        if (this.props.disabled) {
            this.state = { ...this.state, isDisabled: this.props.disabled };
        }
    }

    override shouldComponentUpdate(nextProps: ICheckBoxLineComponentProps, nextState: { isSelected: boolean; isDisabled: boolean; isConflict: boolean }) {
        let selected: boolean;

        if (nextProps.isSelected !== undefined) {
            selected = typeof nextProps.isSelected === "boolean" ? nextProps.isSelected : nextProps.isSelected();
        } else {
            selected = nextProps.target[nextProps.propertyName!] === true;
            if (nextProps.target[nextProps.propertyName!] === conflictingValuesPlaceholder) {
                nextState.isConflict = true;
            }
        }

        if (selected !== nextState.isSelected || this._localChange) {
            nextState.isSelected = selected;
            this._localChange = false;
            return true;
        }

        if (nextProps.disabled !== nextState.isDisabled) {
            return true;
        }

        return nextProps.label !== this.props.label || nextProps.target !== this.props.target || nextState.isConflict !== this.state.isConflict;
    }

    onChange() {
        this._localChange = true;
        if (this.props.onSelect) {
            this.props.onSelect(!this.state.isSelected);
        } else {
            if (this.props.onPropertyChangedObservable) {
                this.props.onPropertyChangedObservable.notifyObservers({
                    object: this.props.target,
                    property: this.props.propertyName!,
                    value: !this.state.isSelected,
                    initialValue: this.state.isSelected,
                });
            }

            if (this.props.target && this.props.propertyName) {
                this.props.target[this.props.propertyName] = !this.state.isSelected;
            }
        }

        if (this.props.onValueChanged) {
            this.props.onValueChanged();
        }

        this.setState({ isSelected: !this.state.isSelected, isConflict: false });
    }

    // Copy to clipboard the code this checkbox actually does
    // Example : mesh.checkCollisions = true;
    onCopyClick() {
        if (this.props && this.props.target) {
            const { className, babylonNamespace } = getClassNameWithNamespace(this.props.target);
            const targetName = "globalThis.debugNode";
            const targetProperty = this.props.propertyName;
            const value = this.props.target[this.props.propertyName!];
            const strCommand = targetName + "." + targetProperty + " = " + value + ";// (debugNode as " + babylonNamespace + className + ")";
            copyCommandToClipboard(strCommand);
        } else {
            copyCommandToClipboard("undefined");
        }
    }

    renderOriginal() {
        const icons = this.props.large ? Icons.size40 : Icons.size30;
        const icon = this.state.isConflict ? icons.mixed : this.state.isSelected ? icons.on : icons.off;
        return (
            <div className="checkBoxLine">
                {this.props.icon && <img src={this.props.icon} title={this.props.iconLabel} alt={this.props.iconLabel} className="icon" />}
                {this.props.label && (
                    <div className="label" title={this.props.iconLabel}>
                        {this.props.label}
                    </div>
                )}
                {this.props.faIcons && (
                    <FontAwesomeIcon
                        className={`cbx ${this.props.disabled ? "disabled" : ""}`}
                        icon={this.state.isSelected ? this.props.faIcons.enabled : this.props.faIcons.disabled}
                        onClick={() => !this.props.disabled && this.onChange()}
                    />
                )}
                {!this.props.faIcons && (
                    <div className="checkBox">
                        <label className={`container lbl${this.props.disabled ? " disabled" : ""} ${this.state.isSelected ? "checked" : ""}`}>
                            <input
                                type="checkbox"
                                className={`cbx hidden ${this.state.isConflict ? "conflict" : ""}`}
                                checked={this.state.isSelected}
                                onChange={() => this.onChange()}
                                disabled={!!this.props.disabled}
                            />
                            <img className="icon" src={icon} alt={this.props.label} />
                        </label>
                    </div>
                )}
                <div className="copy hoverIcon" onClick={() => this.onCopyClick()} title="Copy to clipboard">
                    <img src={copyIcon} alt="Copy" />
                </div>
            </div>
        );
    }

    renderFluent() {
        // if faIcons are sent (to mimic a checkbox) use fluent checkbox
        if (this.props.faIcons) {
            return <Checkbox disabled={this.props.disabled} value={this.state.isSelected} onChange={() => !this.props.disabled && this.onChange()} />;
        }
        return <SwitchPropertyLine label={this.props.label || ""} value={this.state.isSelected} onChange={() => this.onChange()} disabled={!!this.props.disabled} />;
    }

    override render() {
        return <ToolContext.Consumer>{({ useFluent }) => (useFluent ? this.renderFluent() : this.renderOriginal())}</ToolContext.Consumer>;
    }
}
