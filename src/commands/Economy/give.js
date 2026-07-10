import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('give')
        .setDescription('Give currency to yourself or another user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to give currency to (defaults to yourself)')
                .setRequired(false)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('The amount of currency to give')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, true);
        if (!deferred) return;

        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const amount = Math.floor(interaction.options.getNumber('amount'));
            const guildId = interaction.guildId;
            const userId = targetUser.id;

            logger.debug(`[ECONOMY] Give command started`, {
                executor: interaction.user.id,
                target: userId,
                amount,
                guildId
            });

            // Get target user's economy data
            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Failed to load economy data for give command",
                    ErrorTypes.DATABASE,
                    "Failed to load economy data. Please try again later.",
                    { userId, guildId }
                );
            }

            // Add currency to target user
            userData.wallet = (userData.wallet || 0) + amount;

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Currency given`, {
                executor: interaction.user.id,
                recipient: userId,
                amount,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const targetLabel = targetUser.id === interaction.user.id ? 'yourself' : `${targetUser.username}`;

            const embed = createEmbed({
                title: '💸 Currency Transferred',
                description: [
                    `✅ Successfully gave **$${amount.toLocaleString()}** to ${targetLabel}`,
                    ``,
                    `👤 **Recipient:** ${targetUser}`,
                    `💵 **Amount:** $${amount.toLocaleString()}`,
                    `💳 **New Balance:** $${userData.wallet.toLocaleString()}`
                ].join('\n'),
                color: 'success',
                timestamp: true
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

        } catch (error) {
            if (error.isCustom) throw error;
            throw createError(
                'Unexpected error in give command',
                ErrorTypes.INTERNAL,
                'An unexpected error occurred. Please try again later.',
                { error: error.message }
            );
        }
    }, { command: 'give' })
};
