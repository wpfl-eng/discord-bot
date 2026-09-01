// Casino Modals
//
// Modals built on the current component set. `Label` (type 18) wraps each input and
// carries its caption and help text; wrapping a `TextInput` in an `ActionRow` — which
// this codebase did at roulette.ts:412 — is the deprecated form.
//
// `RadioGroup` and `CheckboxGroup` are modal-only and must sit inside a `Label`. They
// exist here because they collapse several clicks into one submit: choosing an odds
// multiple, or taking a seat with a stake and side-bet selections together.

import {
  CheckboxGroupBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

// ============ AMOUNT ============

export interface AmountModalSpec {
  readonly id: string;
  readonly title: string;
  /** Caption above the field */
  readonly label: string;
  /** Help text under the caption */
  readonly description?: string;
  readonly fieldId: string;
  readonly placeholder?: string;
}

/**
 * A single-field modal asking for a number.
 *
 * @param spec - identifiers and captions
 */
export function amountModal(spec: AmountModalSpec): ModalBuilder {
  const label = new LabelBuilder().setLabel(spec.label).setTextInputComponent(
    new TextInputBuilder()
      .setCustomId(spec.fieldId)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(9)
      .setPlaceholder(spec.placeholder ?? '')
  );

  if (spec.description) label.setDescription(spec.description);

  return new ModalBuilder()
    .setCustomId(spec.id)
    .setTitle(spec.title.slice(0, 45))
    .addLabelComponents(label);
}

// ============ SINGLE CHOICE ============

export interface ChoiceOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly default?: boolean;
}

export interface ChoiceModalSpec {
  readonly id: string;
  readonly title: string;
  readonly label: string;
  readonly description?: string;
  readonly fieldId: string;
  readonly options: readonly ChoiceOption[];
}

/**
 * A one-of-N modal built on `RadioGroup`.
 *
 * Preferred over a string select for a short, fixed set — every option is visible at
 * once rather than behind a dropdown.
 */
export function choiceModal(spec: ChoiceModalSpec): ModalBuilder {
  const radio = new RadioGroupBuilder()
    .setCustomId(spec.fieldId)
    .setRequired(true)
    .setOptions(
      spec.options.map((option) => ({
        label: option.label,
        value: option.value,
        ...(option.description ? { description: option.description } : {}),
        ...(option.default ? { default: true } : {}),
      }))
    );

  const label = new LabelBuilder().setLabel(spec.label).setRadioGroupComponent(radio);
  if (spec.description) label.setDescription(spec.description);

  return new ModalBuilder()
    .setCustomId(spec.id)
    .setTitle(spec.title.slice(0, 45))
    .addLabelComponents(label);
}

// ============ AMOUNT PLUS TOGGLES ============

export interface AmountWithTogglesSpec extends AmountModalSpec {
  readonly toggleLabel: string;
  readonly toggleDescription?: string;
  readonly toggleFieldId: string;
  readonly toggles: readonly ChoiceOption[];
}

/**
 * A stake field plus a set of independent on/off choices, in one submit.
 *
 * This is what makes taking a blackjack seat one interaction instead of three: the
 * stake and both side bets are collected together.
 */
export function amountWithTogglesModal(spec: AmountWithTogglesSpec): ModalBuilder {
  const modal = amountModal(spec);

  const group = new CheckboxGroupBuilder()
    .setCustomId(spec.toggleFieldId)
    .setRequired(false)
    .setOptions(
      spec.toggles.map((option) => ({
        label: option.label,
        value: option.value,
        ...(option.description ? { description: option.description } : {}),
        ...(option.default ? { default: true } : {}),
      }))
    );

  const label = new LabelBuilder().setLabel(spec.toggleLabel).setCheckboxGroupComponent(group);
  if (spec.toggleDescription) label.setDescription(spec.toggleDescription);

  return modal.addLabelComponents(label);
}

// ============ PARSING ============

/**
 * Parse a stake typed by a player.
 *
 * Accepts plain digits, thousands separators, spaces, and the shorthand `all` / `max`.
 *
 * @param raw - the submitted text
 * @param wallet - the player's balance, used to resolve `all`
 * @returns the stake, or null when the input is not a usable amount
 */
export function parseStake(raw: string, wallet: number): number | null {
  const normalised: string = raw.trim().toLowerCase().replace(/[, ]/g, '');

  if (normalised === 'all' || normalised === 'max') {
    return wallet > 0 ? wallet : null;
  }

  // Reject '12abc': parseInt would happily return 12.
  if (!/^\d+$/.test(normalised)) return null;

  const parsed: number = Number.parseInt(normalised, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;

  return parsed;
}
