import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";

/**
 * Predefined color map for easy color selection
 * @type {Record<string, string>}
 */
const PREDEFINED_COLORS = {
  red: "#E74C3C",
  blue: "#3498DB",
  green: "#2ECC71",
  purple: "#9B59B6",
  orange: "#E67E22",
  pink: "#E91E63",
  cyan: "#00BCD4",
  gold: "#F1C40F",
  white: "#FFFFFF",
};

/**
 * Role name prefix for color roles
 * @type {string}
 */
const COLOR_ROLE_PREFIX = "color-";

/**
 * Parse a color input string into a valid hex color
 * @param {string} input - Color input (hex code or predefined name)
 * @returns {{ valid: boolean, hex?: string, error?: string }}
 */
function parseColor(input) {
  const normalizedInput = input.toLowerCase().trim();

  // Check if it's a predefined color
  if (PREDEFINED_COLORS[normalizedInput]) {
    return { valid: true, hex: PREDEFINED_COLORS[normalizedInput] };
  }

  // Try to parse as hex
  let hexValue = normalizedInput;

  // Remove common prefixes
  if (hexValue.startsWith("#")) {
    hexValue = hexValue.slice(1);
  } else if (hexValue.startsWith("0x")) {
    hexValue = hexValue.slice(2);
  }

  // Validate hex format (must be 6 characters, valid hex)
  if (!/^[0-9a-f]{6}$/i.test(hexValue)) {
    const colorNames = Object.keys(PREDEFINED_COLORS).join(", ");
    return {
      valid: false,
      error: `Invalid color. Use a hex code (e.g., #FF5733) or a color name: ${colorNames}`,
    };
  }

  return { valid: true, hex: `#${hexValue.toUpperCase()}` };
}

/**
 * Get the color role name for a user
 * @param {string} userId - Discord user ID
 * @returns {string}
 */
function getColorRoleName(userId) {
  return `${COLOR_ROLE_PREFIX}${userId}`;
}

export const data = new SlashCommandBuilder()
  .setName("namecolor")
  .setDescription("Change your display name color in the server")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Set your name color")
      .addStringOption((option) =>
        option
          .setName("color")
          .setDescription("Hex code (#FF5733) or color name (red, blue, green, purple, orange, pink, cyan, gold)")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("remove").setDescription("Remove your custom name color")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("Show available predefined colors")
  );

/**
 * Execute the namecolor command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "set":
      await handleSet(interaction);
      break;
    case "remove":
      await handleRemove(interaction);
      break;
    case "list":
      await handleList(interaction);
      break;
  }
}

/**
 * Handle /namecolor set subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSet(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Verify bot has permission to manage roles
    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply({
        content: "I don't have permission to manage roles. Please ask a server admin to grant me the 'Manage Roles' permission.",
      });
      return;
    }

    const colorInput = interaction.options.getString("color");
    const parseResult = parseColor(colorInput);

    if (!parseResult.valid) {
      await interaction.editReply({ content: parseResult.error });
      return;
    }

    const { hex } = parseResult;
    const userId = interaction.user.id;
    const colorRoleName = getColorRoleName(userId);
    const member = interaction.member;

    // Find existing color role for this user
    let colorRole = interaction.guild.roles.cache.find(
      (role) => role.name === colorRoleName
    );

    if (colorRole) {
      // Check if bot can modify this role (role hierarchy)
      if (colorRole.position >= botMember.roles.highest.position) {
        await interaction.editReply({
          content: "I can't modify your color role because it's positioned higher than my role. Please ask a server admin to move my role higher.",
        });
        return;
      }

      // Update existing role color
      await colorRole.edit({
        color: hex,
        reason: `User ${interaction.user.username} changed their name color`,
      });
    } else {
      // Create new color role
      colorRole = await interaction.guild.roles.create({
        name: colorRoleName,
        color: hex,
        position: 1, // Position above @everyone
        reason: `User ${interaction.user.username} set their name color`,
      });
    }

    // Ensure user has the role
    if (!member.roles.cache.has(colorRole.id)) {
      await member.roles.add(colorRole, "Assigned custom name color");
    }

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(hex)
      .setTitle("Name Color Updated")
      .setDescription(`Your name color has been set to **${hex}**`)
      .setFooter({ text: "Use /namecolor remove to remove your custom color" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("namecolor set error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /namecolor remove subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleRemove(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Verify bot has permission to manage roles
    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply({
        content: "I don't have permission to manage roles. Please ask a server admin to grant me the 'Manage Roles' permission.",
      });
      return;
    }

    const userId = interaction.user.id;
    const colorRoleName = getColorRoleName(userId);

    // Find the user's color role - ONLY match exact name with our prefix
    const colorRole = interaction.guild.roles.cache.find(
      (role) => role.name === colorRoleName
    );

    if (!colorRole) {
      await interaction.editReply({
        content: "You don't have a custom name color set.",
      });
      return;
    }

    // Safety check: Only delete if role name starts with our prefix
    if (!colorRole.name.startsWith(COLOR_ROLE_PREFIX)) {
      await interaction.editReply({
        content: "Error: Found a role that doesn't match the expected format. No changes made.",
      });
      return;
    }

    // Check if bot can delete this role (role hierarchy)
    if (colorRole.position >= botMember.roles.highest.position) {
      await interaction.editReply({
        content: "I can't delete your color role because it's positioned higher than my role. Please ask a server admin to move my role higher.",
      });
      return;
    }

    // Delete the role entirely
    await colorRole.delete(`User ${interaction.user.username} removed their custom color`);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("Name Color Removed")
      .setDescription("Your custom name color has been removed.")
      .setFooter({ text: "Use /namecolor set <color> to set a new color" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("namecolor remove error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /namecolor list subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleList(interaction) {
  const colorList = Object.entries(PREDEFINED_COLORS)
    .map(([name, hex]) => `**${name}** - \`${hex}\``)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Available Colors")
    .setDescription(
      `You can use any of these color names or enter a custom hex code:\n\n${colorList}`
    )
    .addFields({
      name: "Custom Colors",
      value: "You can also use any hex code like `#FF5733` or `FF5733`",
    })
    .setFooter({ text: "Use /namecolor set <color> to set your color" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
