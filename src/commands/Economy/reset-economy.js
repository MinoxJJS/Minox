import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('reset-economy')
        .setDescription('🚨 ADMIN ONLY: Reset all economy data for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addBooleanOption(option =>
            option
                .setName('confirm')
                .setDescription('Type TRUE to confirm this action cannot be undone')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: 64, // Ephemeral
        });
        if (!deferred) return;

        const confirmed = interaction.options.getBoolean('confirm');
        const guildId = interaction.guildId;
        const executor = interaction.user.id;

        if (!confirmed) {
            const embed = warningEmbed(
                '⚠️ Reset Cancelled',
                'You must confirm the action by setting **confirm to TRUE**.\n\n⚠️ **WARNING:** This action is **IRREVERSIBLE** and will delete all economy data for every user in this server!'
            );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            return;
        }

        logger.warn(`[ECONOMY] Reset requested by ${interaction.user.tag} (${executor}) in guild ${guildId}`, {
            guildId,
            executor,
            action: 'reset-economy'
        });

        const prefix = `economy:${guildId}:`;
        
        try {
            const allKeys = await client.db.list(prefix);
            let deletedCount = 0;

            if (Array.isArray(allKeys) && allKeys.length > 0) {
                for (const key of allKeys) {
                    await client.db.delete(key);
                    deletedCount++;
                }
            }

            logger.info(`[ECONOMY] Economy data reset completed`, {
                guildId,
                executor,
                usersReset: deletedCount,
                timestamp: new Date().toISOString()
            });

            const embed = successEmbed(
                '✅ Economy Reset Complete',
                `Successfully deleted economy data for **${deletedCount}** users in this server.\n\n⚠️ This action has been logged and cannot be undone.`
            )
                .addFields({
                    name: 'Reset by',
                    value: `<@${executor}>`,
                    inline: true,
                })
                .addFields({
                    name: 'Users affected',
                    value: `${deletedCount}`,
                    inline: true,
                })
                .setFooter({
                    text: 'Audit: Reset Economy Data',
                    iconURL: interaction.guild.iconURL(),
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('[ECONOMY] Reset economy failed', {
                guildId,
                executor,
                error: error.message,
                stack: error.stack
            });

            throw createError(
                'Reset failed',
                ErrorTypes.DATABASE,
                'Failed to reset economy data. Check the server logs for details.',
                { error: error.message, guildId }
            );
        }
    }, { command: 'reset-economy' })
};
