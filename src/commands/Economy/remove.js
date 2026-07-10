import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove currency from yourself or another user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to remove currency from (defaults to yourself)')
                .setRequired(false)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('The amount of currency to remove')
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

            logger.debug(`[ECONOMY] Remove command started`, {
                executor: interaction.user.id,
                target: userId,
                amount,
                guildId
            });

            // Get target user's economy data
            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Failed to load economy data for remove command",
                    ErrorTypes.DATABASE,
                    "Failed to load economy data. Please try again later.",
                    { userId, guildId }
                );
            }

            const currentWallet = userData.wallet || 0;
            const amountRemoved = Math.min(amount, currentWallet);

            // Remove currency from target user (can't go below 0)
            userData.wallet = Math.max(0, currentWallet - amount);

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Currency removed`, {
                executor: interaction.user.id,
                target: userId,
                amountRequested: amount,
                amountRemoved,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const targetLabel = targetUser.id === interaction.user.id ? 'yourself' : `${targetUser.username}`;

            const embed = createEmbed({
                title: '💸 Currency Removed',
                description: [
                    `✅ Successfully removed **$${amountRemoved.toLocaleString()}** from ${targetLabel}`,
                    amountRemoved < amount ? `⚠️ *Note: Only $${amountRemoved.toLocaleString()} was available to remove*` : '',
                    ``,
                    `👤 **Target:** ${targetUser}`,
                    `💵 **Amount Removed:** $${amountRemoved.toLocaleString()}`,
                    `💳 **New Balance:** $${userData.wallet.toLocaleString()}`
                ].filter(line => line !== '').join('\n'),
                color: 'error',
                timestamp: true
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

        } catch (error) {
            if (error.isCustom) throw error;
            throw createError(
                'Unexpected error in remove command',
                ErrorTypes.INTERNAL,
                'An unexpected error occurred. Please try again later.',
                { error: error.message }
            );
        }
    }, { command: 'remove' })
};
