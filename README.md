# Commish Bot

Malevolently Robotting For Life.

### Installation

```bash
make install
```

### Development

Project heavily relies on the discord.js package https://discordjs.guide/#before-you-begin

To create a new command, create a new directory and .js file in the `/discordCommands` directory

```
discord-bot
│   README.md
│
└───discordCommands
│   └───ping
│       │   ping.js
│       │
```

When creating a new command, you need two things:

1. A `data` export to configure the slash command used to call the execute function

For example, this is the trophies command slash configuration. It sets the name for `/trophies` as well as
the description and fields allowing the user to choose week and year of the season.

```
export const data = new SlashCommandBuilder()
  .setName("trophies")
  .setDescription("Returns trophies by week and year")
  .addStringOption((option) =>
    option
      .setName("week")
      .setDescription("Input week of matchup")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("year")
      .setDescription("Input year of matchup")
      .setRequired(true)
  );
```

2. An async execute function that returns the response for the discord bot

For example, here is the `/ping` execute function

```
export async function execute(interaction) {
  await interaction.reply({ content: "Secret Pong!", ephemeral: true });
}
```

`interaction` will be what holds the value from the data function. For example, using the `/trophies`
code from above, you can access the values like so:
`const matchupWeek = interaction.options.getInteger("week");`
