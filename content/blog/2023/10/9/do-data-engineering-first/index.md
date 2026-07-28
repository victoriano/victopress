---
title: "Do Data Engineering First"
slug: "2023/10/9/do-data-engineering-first"
date: 2023-10-09
description: "Most executives follow trends without really understanding the technology behind AI and LLMs; only a small percentage of companies may benefit from customising their own models."
author: "Victoriano Izquierdo"
locale: en
draft: true
format: markdown
categories: [data, product, business]
tags: ["Data Analytics", "Generative AI", "Data Engineering"]
sourceUrl: "https://app.notion.com/p/7241b455750246689d28b5df71935ede"
cover: "blog/2023/10/9/do-data-engineering-first/data-maturity-ladder.jpg"
coverInBody: true
---

Most executives follow trends without really understanding the technology behind AI and LLMs, only a small percentage of companies may actually benefit from training and customising their own models.

As happened years ago with IBM Watson, many will invest resources in something that will become outdated instead of investing in the fundamentals to extract business intelligence from the data they produce.

This goes through the entire ladder of understanding which business problems truly make sense to solve, measuring accurately, having good data infrastructure, well-defined descriptive dashboards, and advanced analytics to understand the 'why,' prototype models, and do forecasting

![](/api/images/blog/2023/10/9/do-data-engineering-first/data-maturity-ladder.jpg "text-width")

![](/api/images/blog/2023/10/9/do-data-engineering-first/data-analysis-process.png "text-width")

[Related post on X](https://twitter.com/SeattleDataGuy/status/1723090286576898476/photo/1)

**Data**, by nature, **is always subjective** and without **human interpretation**, is **meaningless**.

Even with all the incredible advancements of AI and Large Language Models (LLMs), I believe there are four significant challenges that AI cannot address without a human providing context. Here are my bets, from easiest to hardest to resolve:

1 - **Measurable External Variables** - a competitor campaign, the weather, the celebration of a soccer match, a pandemic, normalising data by a country’s population… All these variables, often not included in your internal datasets, are usually crucial for explaining why something has occurred. Among the challenges I'll mention, this is the "simplest" one, and AI, especially helping find alternative data from companies like Cybersync, will assist. However, the range of external data variables is so vast that we probably still need humans to decide which data to look for each context, with expertise in the field.

2 - **Difficult/Impossible to Measure Internal Variables.** The most important and predictive variables are often extremely expensive, difficult, or directly impossible to measure. Even measuring socio-demographic or firmographic factors of customers tends to be challenging. Asking for age in a form creates friction, and asking for gender raises suspicions about how that data will be used. Psychographics are even more challenging to measure. They might be inferred from a clickstream of behavior events when using a digital product. But often, these variables can only be measured through human-to-human interviews, **extracting information through sales artistry** and human complicity - what is commonly referred to as **qualitative** **data**. These conversations often inspire new variables that no one had thought of.

3 - **Humans Can Identify and Adapt to Emerging Trends That Pre-existing Data Models Do Not Recognize.** Learning from past data is possible, but humans continuously adapt their behavior. For instance, you may offer discounts to customers who bought certain products to incentivize them to purchase others. However, your customers will learn, and the coupon might end up cannibalizing future purchases of other products without you realizing it.

4 - **Understanding the Data Analysis Process Is Critical for Building the Necessary Trust for Decision-making.** Any analysis involves numerous decisions and assumptions about the data. This includes how the data is sampled, filtered, which variables are ignored, which are considered, and how it is visualized. Small changes can lead to entirely opposite conclusions. This uncertainty means that virtually no one, no matter how much they believe in data, can be entirely sure about the conclusions drawn.

Without tools that allow for an intuitive and straightforward understanding of why specific analysis decisions were made, it is highly likely that decision-makers will not gain sufficient confidence and conviction to act boldly and decisively. These interfaces must guide and instill confidence in the analysis process, which is what we aim to achieve with Graphext.
