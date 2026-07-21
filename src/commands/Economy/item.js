import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('item')
        .setDescription('Manage your items from the shop')
        .addSubcommand(subcommand =>
            subcommand
                .setName('give')
                .setDescription('Give an item to yourself or another user')
                .addStringOption(option =>
                    option
                        .setName('itemname')
                        .setDescription('The name of the item to give')
                        .setRequired(true)
                )
                .addNumberOption(option =>
                    option
                        .setName('amount')
                        .setDescription('The amount of items to give')
                        .setRequired(true)
                        .setMinValue(1)
                )
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user to give the item to (defaults to yourself)')
                        .setRequired(false)
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, true);
        if (!deferred) return;

        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'give') {
                const itemName = interaction.options.getString('itemname');
                const amount = Math.floor(interaction.options.getNumber('amount'));
                const targetUser = interaction.options.getUser('user') || interaction.user;
                const guildId = interaction.guildId;
                const userId = targetUser.id;

                logger.debug(`[ECONOMY] Item give command started`, {
                    executor: interaction.user.id,
                    target: userId,
                    item: itemName,
                    amount,
                    guildId
                });

                // Get target user's economy data
                const userData = await getEconomyData(client, guildId, userId);

                if (!userData) {
                    throw createError(
                        "Failed to load economy data for item give command",
                        ErrorTypes.DATABASE,
                        "Failed to load economy data. Please try again later.",
                        { userId, guildId }
                    );
                }

                // Initialize inventory if it doesn't exist
                if (!userData.inventory) {
                    userData.inventory = {};
                }

                // Add item to inventory
                userData.inventory[itemName] = (userData.inventory[itemName] || 0) + amount;

                await setEconomyData(client, guildId, userId, userData);

                logger.info(`[ECONOMY_TRANSACTION] Item given`, {
                    executor: interaction.user.id,
                    recipient: userId,
                    item: itemName,
                    amount,
                    newInventoryCount: userData.inventory[itemName],
                    timestamp: new Date().toISOString()
                });

                const targetLabel = targetUser.id === interaction.user.id ? 'yourself' : `${targetUser.username}`;

                const embed = createEmbed({
                    title: '🎁 Item Transferred',
                    description: [
                        `✅ Successfully gave **${amount}x ${itemName}** to ${targetLabel}`,
                        ``,
                        `👤 **Recipient:** ${targetUser}`,
                        `📦 **Item:** ${itemName}`,
                        `📊 **Amount:** ${amount}`,
                        `🎒 **New Inventory Count:** ${userData.inventory[itemName]}`
                    ].join('\n'),
                    color: 'success',
                    timestamp: true
                });

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            }

        } catch (error) {
            if (error.isCustom) throw error;
            throw createError(
                'Unexpected error in item command',
                ErrorTypes.INTERNAL,
                'An unexpected error occurred. Please try again later.',
                { error: error.message }
            );
        }
    }, { command: 'item' })
};
