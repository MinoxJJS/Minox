import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const BUSINESS_STARTUP_COST = 1_000_000;
const MAX_BUSINESSES = 5;
const BUSINESS_INCOME_COOLDOWN = 4 * 60 * 60 * 1000; // 4 hours
const MIN_PASSIVE_INCOME = 50_000;
const MAX_PASSIVE_INCOME = 300_000;

const BUSINESS_TYPES = [
    { name: "Software Development Studio", multiplier: 1.2, description: "High-paying tech services" },
    { name: "Coffee Shop", multiplier: 0.8, description: "Steady but modest returns" },
    { name: "Cleaning Service", multiplier: 0.9, description: "Reliable income stream" },
    { name: "YouTube Channel", multiplier: 1.3, description: "Content creation empire" },
    { name: "Bot Development Firm", multiplier: 1.4, description: "Premium automation services" },
    { name: "Retail Store", multiplier: 1.0, description: "Classic business model" },
    { name: "Delivery Network", multiplier: 1.1, description: "Logistics and distribution" },
    { name: "Library & Bookstore", multiplier: 0.7, description: "Niche but profitable" },
    { name: "Landscaping Company", multiplier: 0.95, description: "Seasonal but steady" },
    { name: "Data Analytics Firm", multiplier: 1.25, description: "Business intelligence services" },
];

function getRandomBusiness() {
    return BUSINESS_TYPES[Math.floor(Math.random() * BUSINESS_TYPES.length)];
}

function calculatePassiveIncome(baseAmount, multiplier) {
    return Math.floor(baseAmount * multiplier);
}

export default {
    data: new SlashCommandBuilder()
        .setName('business')
        .setDescription('Start or manage your passive income businesses')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a new business (costs $1,000,000)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('collect')
                .setDescription('Collect passive income from your businesses')
                .addIntegerOption(option =>
                    option
                        .setName('business_id')
                        .setDescription('The ID of the business to collect from (1-5)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(MAX_BUSINESSES)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('View your businesses')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('close')
                .setDescription('Close a business and sell for 50% of startup cost')
                .addIntegerOption(option =>
                    option
                        .setName('business_id')
                        .setDescription('The ID of the business to close (1-5)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(MAX_BUSINESSES)
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();
        const subcommand = interaction.options.getSubcommand();

        const userData = await getEconomyData(client, guildId, userId);

        if (!userData) {
            throw createError(
                "Failed to load economy data for business",
                ErrorTypes.DATABASE,
                "Failed to load your economy data. Please try again later.",
                { userId, guildId }
            );
        }

        logger.debug(`[ECONOMY] Business command started for ${userId}`, { userId, guildId, subcommand });

        // Initialize businesses array if it doesn't exist
        if (!userData.businesses) {
            userData.businesses = [];
        }

        if (subcommand === 'start') {
            if (userData.businesses.length >= MAX_BUSINESSES) {
                throw createError(
                    "Maximum businesses reached",
                    ErrorTypes.INVALID_STATE,
                    `You can only own up to **${MAX_BUSINESSES}** businesses! Sell one with \`/business close\` to start another.`,
                    { userId, maxBusinesses: MAX_BUSINESSES }
                );
            }

            if ((userData.wallet || 0) < BUSINESS_STARTUP_COST) {
                throw createError(
                    "Insufficient funds",
                    ErrorTypes.INSUFFICIENT_BALANCE,
                    `You need **$${BUSINESS_STARTUP_COST.toLocaleString()}** to start a business. You only have **$${(userData.wallet || 0).toLocaleString()}**.`,
                    { userId, required: BUSINESS_STARTUP_COST, current: userData.wallet }
                );
            }

            const businessType = getRandomBusiness();

            userData.wallet -= BUSINESS_STARTUP_COST;
            userData.businesses.push({
                id: userData.businesses.length + 1,
                type: businessType.name,
                multiplier: businessType.multiplier,
                startDate: now,
                lastIncome: now,
                totalIncome: 0,
            });

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_BUSINESS] Business started`, {
                userId,
                guildId,
                businessType: businessType.name,
                multiplier: businessType.multiplier,
                cost: BUSINESS_STARTUP_COST,
                businessCount: userData.businesses.length,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const embed = successEmbed(
                "🏢 Business Started!",
                `Congratulations! You've started a **${businessType.name}**!\n\n${businessType.description}`
            )
                .addFields(
                    { name: "📊 Business Type", value: businessType.name, inline: true },
                    { name: "💰 Income Multiplier", value: `${(businessType.multiplier * 100).toFixed(0)}%`, inline: true },
                    { name: "🆔 Business #", value: `${userData.businesses.length}/${MAX_BUSINESSES}`, inline: true },
                    { name: "💳 Startup Cost", value: `$${BUSINESS_STARTUP_COST.toLocaleString()}`, inline: true },
                    { name: "💵 Remaining Balance", value: `$${userData.wallet.toLocaleString()}`, inline: true },
                    { name: "⏰ Income Cooldown", value: "4 hours between collections", inline: true }
                );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

        } else if (subcommand === 'collect') {
            if (userData.businesses.length === 0) {
                throw createError(
                    "No active businesses",
                    ErrorTypes.INVALID_STATE,
                    "You don't own any businesses! Use `/business start` to create one.",
                    { userId }
                );
            }

            let businessId = interaction.options.getInteger('business_id');
            
            if (!businessId) {
                // If no ID specified, collect from all ready businesses
                let collected = 0;
                let totalIncome = 0;
                let businessesUpdated = [];

                for (let business of userData.businesses) {
                    const lastIncome = business.lastIncome || 0;
                    if (now - lastIncome >= BUSINESS_INCOME_COOLDOWN) {
                        const baseIncome = Math.floor(Math.random() * (MAX_PASSIVE_INCOME - MIN_PASSIVE_INCOME + 1)) + MIN_PASSIVE_INCOME;
                        const income = calculatePassiveIncome(baseIncome, business.multiplier);

                        business.lastIncome = now;
                        business.totalIncome = (business.totalIncome || 0) + income;
                        totalIncome += income;
                        collected++;
                        businessesUpdated.push({
                            name: business.type,
                            income: income,
                            id: userData.businesses.indexOf(business) + 1
                        });
                    }
                }

                if (collected === 0) {
                    throw createError(
                        "No businesses ready",
                        ErrorTypes.RATE_LIMIT,
                        "None of your businesses are ready to collect from yet. Check `/business info` to see when they'll be ready.",
                        { userId }
                    );
                }

                userData.wallet = (userData.wallet || 0) + totalIncome;
                await setEconomyData(client, guildId, userId, userData);

                logger.info(`[ECONOMY_BUSINESS] Income collected from multiple businesses`, {
                    userId,
                    guildId,
                    businessesCount: collected,
                    totalIncome,
                    newWallet: userData.wallet,
                    timestamp: new Date().toISOString()
                });

                const businessList = businessesUpdated.map(b => `**${b.id}. ${b.name}:** $${b.income.toLocaleString()}`).join('\n');

                const embed = successEmbed(
                    "💰 Income Collected!",
                    `You collected passive income from **${collected}** business(es)!`
                )
                    .addFields(
                        { name: "📊 Collections", value: businessList, inline: false },
                        { name: "💵 Total Income", value: `$${totalIncome.toLocaleString()}`, inline: true },
                        { name: "💳 New Balance", value: `$${userData.wallet.toLocaleString()}`, inline: true }
                    );

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } else {
                // Collect from specific business
                if (businessId < 1 || businessId > userData.businesses.length) {
                    throw createError(
                        "Invalid business ID",
                        ErrorTypes.INVALID_INPUT,
                        `You don't have a business #${businessId}. You own **${userData.businesses.length}** business(es).`,
                        { userId }
                    );
                }

                const business = userData.businesses[businessId - 1];
                const lastIncome = business.lastIncome || 0;
                
                if (now - lastIncome < BUSINESS_INCOME_COOLDOWN) {
                    const remaining = lastIncome + BUSINESS_INCOME_COOLDOWN - now;
                    throw createError(
                        "Business income cooldown active",
                        ErrorTypes.RATE_LIMIT,
                        `This business is still generating income. Try again in **${Math.floor(remaining / 60000)}** minutes.`,
                        { timeRemaining: remaining }
                    );
                }

                const baseIncome = Math.floor(Math.random() * (MAX_PASSIVE_INCOME - MIN_PASSIVE_INCOME + 1)) + MIN_PASSIVE_INCOME;
                const income = calculatePassiveIncome(baseIncome, business.multiplier);

                userData.wallet = (userData.wallet || 0) + income;
                business.lastIncome = now;
                business.totalIncome = (business.totalIncome || 0) + income;

                await setEconomyData(client, guildId, userId, userData);

                logger.info(`[ECONOMY_BUSINESS] Income collected from single business`, {
                    userId,
                    guildId,
                    businessId,
                    businessType: business.type,
                    income,
                    totalIncome: business.totalIncome,
                    newWallet: userData.wallet,
                    timestamp: new Date().toISOString()
                });

                const uptime = Math.floor((now - business.startDate) / (1000 * 60 * 60 * 24));

                const embed = successEmbed(
                    "💰 Income Collected!",
                    `Your **#${businessId} - ${business.type}** generated passive income!`
                )
                    .addFields(
                        { name: "💵 Income This Period", value: `$${income.toLocaleString()}`, inline: true },
                        { name: "📈 Total Lifetime Income", value: `$${business.totalIncome.toLocaleString()}`, inline: true },
                        { name: "💳 New Balance", value: `$${userData.wallet.toLocaleString()}`, inline: true },
                        { name: "⏱️ Business Age", value: `${uptime} days`, inline: true }
                    );

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            }

        } else if (subcommand === 'info') {
            if (userData.businesses.length === 0) {
                throw createError(
                    "No active businesses",
                    ErrorTypes.INVALID_STATE,
                    "You don't own any businesses! Use `/business start` to create one.",
                    { userId }
                );
            }

            const businessFields = userData.businesses.map((business, index) => {
                const uptime = Math.floor((now - business.startDate) / (1000 * 60 * 60 * 24));
                const timeSinceLastIncome = Math.floor((now - business.lastIncome) / 60000);
                const nextIncomeTime = business.lastIncome + BUSINESS_INCOME_COOLDOWN;
                const canCollect = now >= nextIncomeTime;

                return {
                    name: `#${index + 1} - ${business.type}`,
                    value: `**Multiplier:** ${(business.multiplier * 100).toFixed(0)}% | **Age:** ${uptime}d | **Income:** $${business.totalIncome.toLocaleString()}\n**Status:** ${canCollect ? '✅ Ready to collect' : `⏳ ${Math.ceil((nextIncomeTime - now) / 60000)}m remaining`}`,
                    inline: false
                };
            });

            const embed = infoEmbed(
                "🏢 Your Businesses",
                `You own **${userData.businesses.length}/${MAX_BUSINESSES}** businesses`
            )
                .addFields(...businessFields)
                .addFields({
                    name: "💡 Tips",
                    value: `• Use \`/business collect\` to collect from all ready businesses\n• Use \`/business collect <id>\` to collect from a specific one\n• Use \`/business close <id>\` to sell a business`,
                    inline: false
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

        } else if (subcommand === 'close') {
            const businessId = interaction.options.getInteger('business_id');

            if (businessId < 1 || businessId > userData.businesses.length) {
                throw createError(
                    "Invalid business ID",
                    ErrorTypes.INVALID_INPUT,
                    `You don't have a business #${businessId}. You own **${userData.businesses.length}** business(es).`,
                    { userId }
                );
            }

            const business = userData.businesses[businessId - 1];
            const sellPrice = Math.floor(BUSINESS_STARTUP_COST * 0.5);
            const businessType = business.type;

            userData.wallet = (userData.wallet || 0) + sellPrice;
            userData.businesses.splice(businessId - 1, 1);

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_BUSINESS] Business closed`, {
                userId,
                guildId,
                businessId,
                businessType,
                sellPrice,
                businessesRemaining: userData.businesses.length,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const embed = warningEmbed(
                "🏢 Business Closed",
                `You've sold your **#${businessId} - ${businessType}** business.`
            )
                .addFields(
                    { name: "💵 Sale Price", value: `$${sellPrice.toLocaleString()} (50% of startup cost)`, inline: true },
                    { name: "💳 New Balance", value: `$${userData.wallet.toLocaleString()}`, inline: true },
                    { name: "🏢 Businesses Remaining", value: `${userData.businesses.length}/${MAX_BUSINESSES}`, inline: true }
                );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }
    }, { command: 'business' })
};
