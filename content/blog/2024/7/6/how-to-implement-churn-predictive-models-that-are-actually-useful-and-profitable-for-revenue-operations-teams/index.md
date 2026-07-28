---
title: "How to implement churn predictive models that are actually useful and profitable for Revenue Operations teams."
slug: "2024/7/6/how-to-implement-churn-predictive-models-that-are-actually-useful-and-profitable-for-revenue-operations-teams"
date: 2024-07-06
description: "[Illustration of ideal churn with annotations in Hubspot ] [Fletch companies (B2B, B2C) examples with 3 columns ] [Summary Diagram with Types of Churn with boxes hierarchical for slides ] Start with Churn Attribution Most churn predictive models I’ve seen…"
author: "Victoriano Izquierdo"
locale: en
draft: false
format: markdown
tags: ["Data Analytics"]
sourceUrl: "https://app.notion.com/p/68fc4fc1e5994c42a9d6fdd1a9c65cfd"
cover: "blog/2024/7/6/how-to-implement-churn-predictive-models-that-are-actually-useful-and-profitable-for-revenue-operations-teams/image-01.png"
coverInBody: true
---

\[Illustration of ideal churn with annotations in Hubspot\]

\[Fletch companies (B2B, B2C) examples with 3 columns\]

\[Summary Diagram with Types of Churn with boxes hierarchical for slides\]

## Start with Churn Attribution

---

Most churn predictive models I’ve seen in production (whether created by a data science team using Python, by manually assigning weights with heuristic formulas in CRMs, or using some specialized tools) usually produce a single number or score, which typically represents **the probability** that a customer will churn or not renew their contract/service.

This is better than having nothing because it tells us to focus more on customers who might leave. But it also causes a lot of confusion and overthinking for the account managers and customer success teams about **what to do** with those customers.

The best way to prevent churn is to understand** why it happens**, and the key to that is examining **the type and level of engagement** the customer has had with the company.

![](/api/images/blog/2024/7/6/how-to-implement-churn-predictive-models-that-are-actually-useful-and-profitable-for-revenue-operations-teams/image-01.png)

**TLDR**: The ideal approach to churn prediction is probably to combine **a churn probability score** with a simple classification of **churn type based on engagement levels** Include some **metrics** that can provide more clues about the specific type of churn, and link these to a series of **suggested actions** to either prevent it or let it go. If your service/product isn’t designed for a certain type of customer, it’s often best not to waste time on them. It’s also crucial to create a model that can **predict churn weeks or even months in advance**, giving enough time to implement effective measures.

## Churn type based on engagement levels

---

### Customers that never really engaged

Defining a metric to identify when a user becomes loyal is crucial. It often involves tracking a certain number of days of repeated use or purchases, after which most customers develop a habit, resulting in stable retention.

- **Poor Customer Fit** -  This is often the main reason for high customer churn in many companies, especially those that spend a lot on advertising and experience higher than normal churn rates. Customers who never really engaged because the product or service doesn’t meet their needs, lacks key features, or solves a problem that isn’t important to them. Being able to measure clients’ firmographic variables (like industry and company size) or demographic variables helps a model identify these factors. Consider adjusting your marketing to attract fewer of these customers.
- **Bad Onboarding** - You can probably deliver value to these customers, they are the right ICPs, but you’re not successful at teaching them how to use it or work with you. Improve tutorials, UX, push emails in the early days, training programs, better support, and better account managers.

### Decline in Engagement

These customers were highly engaged but they gradually became less engaged for different reasons:

- **They found a better alternative with a competitor**
	- They got a better price - Consider offering a discount
	- They found a better solution - Revisit the product with them, offer free extra support, or sell them professional services.
- The problem they were solving with your solution is **no longer a priority**, or they might have **forgotten about you** - Either let them go or retrain them.
- The champion, **the main contact**, the person that knew how to use your product **left the company** - retrain the team.
- They had a **poor experience with your customer support** - Improve customer support or assign a new account manager. This is pretty common in B2C companies that serve hundreds of thousands or millions of customers. Often, customer service is handled through call centers with low-skilled operators, and complex logistics issues frequently arise.

### Sudden end of engagement

Sometimes users who are engaged suddenly churn and stop paying. Here are some of the most common reasons why:

- **Billing** - In some businesses, this might represent up to 5% of the total churn. Involuntary cancellation due to payment method issues. This is easy to fix, for example, if you detect in advance that a card is expired.
- **Regulatory change in a market  - **A new regulation bans the use of your product or certain features due to privacy, security, and geopolitical concerns.
- **Company shuts down** - Not much you can do it about this ¯\\*(ツ)*/¯

## What type of data is needed to accurately predict churn?

---

### **Transactional Sales data.**

Every business keeps records of everything it sells. The metadata around the date and time of each transaction, user ID, service product IDs, product category and the amount spent are crucial for any model, from simple cohort analysis and RFM models to complex predictive models.

- **The more frequent the transactions** for selling to a customer the more data you generate to learn a pattern and find trends.
- Businesses that rely on **subscriptions** (like SaaS software, content services, or even food delivery) generate strong signals. In contrast, retailers with low customer loyalty (who only make a few occasional purchases each year) are less capable of generating such strong signals for predicting churn. In these cases, it is more interesting to use models that predict repurchase behavior than churn.

### **Usage/Consumption data. **

Almost any business that has gone digital can now gather data not only about sales transactions but also about **every action customers take with their products**. Not just which products they buy, but also which ones they look at and don’t buy. Every click, every scroll, every feature used, and how many people from their team use the product and in what ways. Today, this is **the richest source of data for any churn model**. These events can be easily collected with tools like GA4, Segment, Jitsu, Snowplow, and many others.

- Each product has an **expected usage frequency** based on its nature. For example, an HR  software where hours worked are logged should be used daily, while a language learning app should be used a few times a week. Some services, like utilities and electricity, are used more **seasonally**, increasing during the colder or hotter months.
- Every user follows a path of events while using a product or service. Understanding the **sequence of these events** and any changes can help us understand user churn.This is especially useful for predicting churn caused by onboarding emails or issues with the product’s user experience.

### **Firmographic’s or Demographics Data**

- If your clients are other **businesses**, knowing details like the company’s industry, number of employees, business model, and the role of users can be extremely useful. This information helps you predict how well the client will fit with your product or adjust the expected usage for that type of business. Most CRMs, like HubSpot or Salesforce, can directly provide you with this information by inferring it from your users’ email domains or by using third-party APIs.
- If you’re in B2C, any **demographic** information about your users will help you determine if they fit your Ideal Customer Profile (ICP). Depending on your product, factors like age, city/state, profession, skills, and other variables can be more or less predictive. Some of these variables can be inferred from things like their name (gender), shipping address, or the IP address they connect from (geographic location). Other details can be collected directly from registration forms.

### How the user was acquired

- Information on **how the user learned about the product** is crucial for predicting churn, especially for those who never engage.
- Generally, customers referred by other customers tend to be the most loyal, followed by those who find the product through SEO with purchase intent and **proactivity**, and lastly, those who come through **marketing campaigns**. This variable offers valuable insights for enhancing certain acquisition campaigns over others. This data is typically collected via UTM parameters, but cookie policies and adblockers can make obtaining quality attribution information challenging.

### **Customer Satisfaction Data**:

- Good **customer support** can be a key factor in many industries, helping to retain clients who may not know how to use the product or encounter issues. On the flip side, poor support can drive them away. Most support platforms like Zendesk, Intercom, or CRM systems like Salesforce and Hubspot, log various types of metadata that can help identify potential churn.
- Typical **NPS** surveys (which measure the likelihood of a user recommending the product to others) can also be included in this set of variables that assess the quality of the service.

## So which what type of companies are likely to benefit the most from a predictive churn model?

---

### Companies with many customers and a large potential market

- **The more customers** you have, the better your predictive model can generalize.
- The more customers you have, the greater the impact on predicting and preventing churn, which can help save lost revenue and resources needed to serve all customers. Even moderate improvements in churn rate, from 10% to 20%, can have a multimillion-dollar impact on revenue for large companies.
- Companies that sell to consumers (B2C) often have many customers, although sometimes there’s little or no repeat business. B2B companies that sell to a very niche enterprise market might have only a few hundred clients. In such cases, they often need to pay so much individual attention to each customer that a predictive model may not be useful.
- **B2B companies selling to SMBs** and **mid-market** with long lifetime values, or **B2C companies offering subscriptions to software or content**, are likely the best candidates for achieving a high ROI from churn models.

### Customers Diversity

- The more different the customers are from each other, the higher the chance they will have different behaviours. Customer behavior often varies greatly between different nationalities for a variety of reasons. This makes it harder to develop a sense of what’s normal, even if you do more sophisticated analysis like cohorts or RFM.
- If you sell to very different sectors, company sizes, or diverse demographics, a churn model could be very helpful.

### Products/ Services Diversity

- Almost every large company sells a wide range of products and services used by the same or different customers. The more products they have, the more useful it can be to use a predictive model.
- If you have thousands of product SKUs, one model might not be able to generalize effectively. However, grouping them by categories can help. Also, if your product is multi-featured or you offer many services, these models can assist with cross-selling.

### Your Company Stage

- Churn models only make sense when a company has **achieved product-market fit**. Before that, you’ll have too few users who are too different from each other, and too many product issues for a model to identify clear patterns.
- In **Series A and B,C,D… startups**, it can be very helpful to optimize marketing campaigns by pinpointing which Ideal Customer Profiles (ICPs) are the best fit and figuring out which types of campaigns attract them the most. Additionally, these companies are usually digital natives, so they can often capture high-quality engagement data.
- In **large mature companies** that have a wide variety of clients and products/services, these approaches can be especially useful for the reasons mentioned earlier. Additionally, Revenue Operations teams can make a significant impact by finding efficiency levers in the business through these models.
