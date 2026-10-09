// Native operations for the API connectors where a precise tool set beats a generic `request`.
// Each operation becomes a tool named mcp__<slug>__<name>. GET operations are read-only; every
// other one goes through the coworker's approval rules (appWrites).

const s = (description, extra = {}) => ({ type: 'string', description, ...extra });
const arr = (description, items = { type: 'string' }) => ({ type: 'array', items, description });
const int = (description) => ({ type: 'integer', description });
const bool = (description) => ({ type: 'boolean', description });

const EMAIL = {
  from: s('Sender, e.g. "Ana from Acme <ana@acme.com>" — the domain must be verified in Resend'),
  to: { description: 'Recipient email, or a list of up to 50', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
  subject: s('Subject line'),
  html: s('HTML body'),
  text: s('Plain-text body (always send one for cold emails)'),
  cc: arr('Cc recipients'),
  bcc: arr('Bcc recipients'),
  reply_to: { description: 'Reply-to address(es)', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
  scheduled_at: s('Send later: ISO 8601 date or natural language like "in 1 hour"'),
  headers: { type: 'object', description: 'Custom headers, e.g. In-Reply-To / References to keep a follow-up in the same thread' },
  tags: arr('Tags for analytics', { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'] }),
};

export const SPECS = {
  resend: {
    name: 'Resend',
    docs: 'https://resend.com/docs/api-reference/introduction',
    // Verified against resend.com/docs (llms.txt, Oct 2026): contacts are global, audiences became segments.
    skill: `Resend sends the emails. Before the first send, list the domains and use a "from" on a verified domain (ask the owner which sender to use and save it in memory).
- One email: send_email (always include text, and html if you have it). Many different emails: send_batch (up to 100).
- Follow-ups in the same thread: pass headers In-Reply-To and References with the previous message id when you have it.
- Keep the returned id: get_email tells you if it was delivered, opened, bounced. Log every send in your database.
- Replies: if the owner set up inbound on Resend, list_received_emails shows replies; mark those leads as replied and stop their follow-ups.
- Newsletters: contacts + segments, then create_broadcast and send_broadcast.
- Never send to someone who unsubscribed or bounced. Sending is gated by the owner's approval rules.`,
    ops: [
      { name: 'send_email', method: 'POST', path: '/emails', body: true, description: 'Send one email (or schedule it with scheduled_at). Returns its id.', params: EMAIL, required: ['from', 'to', 'subject'] },
      { name: 'send_batch', method: 'POST', path: '/emails/batch', body: 'array', description: 'Send up to 100 different emails in one call. Each item has the same fields as send_email.', params: { items: arr('The emails', { type: 'object', properties: EMAIL, required: ['from', 'to', 'subject'] }) }, required: ['items'] },
      { name: 'get_email', method: 'GET', path: '/emails/{email_id}', description: 'Read a sent email and its last event (delivered, opened, clicked, bounced, complained).', params: { email_id: s('Email id returned by send_email') }, required: ['email_id'] },
      { name: 'list_emails', method: 'GET', path: '/emails', query: ['limit', 'after', 'before'], description: 'List recently sent emails.', params: { limit: int('Max results (1-100)'), after: s('Cursor: id to list after'), before: s('Cursor: id to list before') } },
      { name: 'reschedule_email', method: 'PATCH', path: '/emails/{email_id}', body: true, description: 'Change when a scheduled email goes out.', params: { email_id: s('Email id'), scheduled_at: s('New send time') }, required: ['email_id', 'scheduled_at'] },
      { name: 'cancel_email', method: 'POST', path: '/emails/{email_id}/cancel', description: 'Cancel a scheduled email before it is sent.', params: { email_id: s('Email id') }, required: ['email_id'] },
      { name: 'list_domains', method: 'GET', path: '/domains', description: 'List sending domains and whether they are verified.', params: {} },
      { name: 'get_domain', method: 'GET', path: '/domains/{domain_id}', description: 'Read a domain with the DNS records to add.', params: { domain_id: s('Domain id') }, required: ['domain_id'] },
      { name: 'create_domain', method: 'POST', path: '/domains', body: true, description: 'Add a sending domain; returns the DNS records the owner must add.', params: { name: s('Domain, e.g. mail.acme.com'), region: s('us-east-1, eu-west-1, sa-east-1 or ap-northeast-1') }, required: ['name'] },
      { name: 'verify_domain', method: 'POST', path: '/domains/{domain_id}/verify', description: 'Ask Resend to check the DNS records of a domain.', params: { domain_id: s('Domain id') }, required: ['domain_id'] },
      { name: 'list_received_emails', method: 'GET', path: '/emails/receiving', query: ['limit', 'after'], description: 'List emails received on your Resend inbound address (replies from leads land here).', params: { limit: int('Max results (1-100)'), after: s('Cursor') } },
      { name: 'get_received_email', method: 'GET', path: '/emails/receiving/{email_id}', description: 'Read one received email: sender, subject, text and html.', params: { email_id: s('Received email id') }, required: ['email_id'] },
      { name: 'get_metrics', method: 'GET', path: '/emails/metrics', query: ['start_date', 'end_date', 'metrics', 'dimensions'], description: 'Account email metrics over a period (sent, delivered, open_rate, click_rate, bounce_rate…).', params: { start_date: s('YYYY-MM-DD'), end_date: s('YYYY-MM-DD'), metrics: s('Comma-separated, e.g. sent,delivered,open_rate'), dimensions: s('Comma-separated, e.g. period,domain') }, required: ['start_date', 'end_date'] },
      { name: 'list_contacts', method: 'GET', path: '/contacts', query: ['limit', 'after', 'segment_id'], description: 'List contacts.', params: { limit: int('Max results'), after: s('Cursor'), segment_id: s('Only the contacts of this segment') } },
      { name: 'get_contact', method: 'GET', path: '/contacts/{contact_id}', description: 'Read a contact by id or email.', params: { contact_id: s('Contact id or email') }, required: ['contact_id'] },
      { name: 'create_contact', method: 'POST', path: '/contacts', body: true, description: 'Create a contact, optionally in segments.', params: { email: s('Email'), first_name: s('First name'), last_name: s('Last name'), unsubscribed: bool('Unsubscribed from all broadcasts'), properties: { type: 'object', description: 'Custom properties' }, segments: arr('Segments to add it to', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }) }, required: ['email'] },
      { name: 'update_contact', method: 'PATCH', path: '/contacts/{contact_id}', body: true, description: 'Update a contact (by id or email), e.g. unsubscribe it.', params: { contact_id: s('Contact id or email'), first_name: s('First name'), last_name: s('Last name'), unsubscribed: bool('Unsubscribed'), properties: { type: 'object', description: 'Custom properties' } }, required: ['contact_id'] },
      { name: 'delete_contact', method: 'DELETE', path: '/contacts/{contact_id}', description: 'Delete a contact (by id or email).', params: { contact_id: s('Contact id or email') }, required: ['contact_id'] },
      { name: 'list_segments', method: 'GET', path: '/segments', description: 'List segments (contact lists).', params: {} },
      { name: 'create_segment', method: 'POST', path: '/segments', body: true, description: 'Create a segment.', params: { name: s('Segment name') }, required: ['name'] },
      { name: 'add_contact_to_segment', method: 'POST', path: '/contacts/{contact_id}/segments/{segment_id}', description: 'Add a contact (id or email) to a segment.', params: { contact_id: s('Contact id or email'), segment_id: s('Segment id') }, required: ['contact_id', 'segment_id'] },
      { name: 'create_broadcast', method: 'POST', path: '/broadcasts', body: true, description: 'Draft a broadcast (newsletter) to a segment.', params: { segment_id: s('Segment id'), from: s('Sender'), subject: s('Subject'), html: s('HTML body; {{{RESEND_UNSUBSCRIBE_URL}}} adds the unsubscribe link'), text: s('Plain-text body'), name: s('Internal name'), reply_to: s('Reply-to') }, required: ['segment_id', 'from', 'subject'] },
      { name: 'send_broadcast', method: 'POST', path: '/broadcasts/{broadcast_id}/send', body: true, description: 'Send (or schedule) a drafted broadcast.', params: { broadcast_id: s('Broadcast id'), scheduled_at: s('Optional send time') }, required: ['broadcast_id'] },
      { name: 'list_broadcasts', method: 'GET', path: '/broadcasts', description: 'List broadcasts and their status.', params: {} },
    ],
  },
  apollo: {
    name: 'Apollo',
    docs: 'https://docs.apollo.io/reference/people-api-search',
    skill: `Apollo is the B2B database for finding leads.
- Find people: people_search with titles, seniorities, locations and company filters (domains, employee ranges, keywords). It does not return emails.
- Get a verified email: people_match with the person's name and company domain (or LinkedIn URL). It costs credits: enrich only the leads you will contact.
- Companies: organization_search to find accounts, organization_enrich to read one by domain.
Store leads in the shared database with their Apollo id to avoid paying twice for the same person.`,
    ops: [
      { name: 'people_search', method: 'POST', path: '/mixed_people/api_search', body: true, readOnly: true, description: 'Search people in Apollo (no emails returned).', params: { person_titles: arr('Job titles, e.g. ["head of sales"]'), person_seniorities: arr('owner, founder, c_suite, partner, vp, head, director, manager, senior, entry'), person_locations: arr('Where people live, e.g. ["France"]'), organization_locations: arr('Company HQ locations'), q_organization_domains_list: arr('Company domains'), organization_num_employees_ranges: arr('e.g. ["11,50","51,200"]'), q_keywords: s('Keywords'), page: int('Page, from 1'), per_page: int('Results per page (max 100)') } },
      { name: 'people_match', method: 'POST', path: '/people/match', body: true, description: 'Enrich one person: verified email, title, LinkedIn. Uses credits.', params: { first_name: s('First name'), last_name: s('Last name'), name: s('Full name'), domain: s('Company domain'), organization_name: s('Company name'), email: s('Known email'), linkedin_url: s('LinkedIn URL'), reveal_personal_emails: bool('Also reveal personal emails (default false)') } },
      { name: 'organization_search', method: 'POST', path: '/mixed_companies/search', body: true, readOnly: true, description: 'Search companies.', params: { q_organization_name: s('Name contains'), organization_locations: arr('HQ locations'), organization_num_employees_ranges: arr('Employee ranges like "11,50"'), q_organization_keyword_tags: arr('Industry keywords'), page: int('Page'), per_page: int('Per page (max 100)') } },
      { name: 'organization_enrich', method: 'GET', path: '/organizations/enrich', query: ['domain'], description: 'Read one company by its domain.', params: { domain: s('Company domain, e.g. acme.com') }, required: ['domain'] },
    ],
  },
};
