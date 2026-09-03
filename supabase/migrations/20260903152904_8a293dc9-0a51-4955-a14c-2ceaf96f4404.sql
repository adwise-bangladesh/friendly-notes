-- ============ 1. WIPE TRANSACTIONAL + CATALOG DATA ============
TRUNCATE TABLE
  public.orders, public.customers, public.products, public.product_variants, public.product_media,
  public.product_categories, public.categories, public.brands, public.inventory_locations,
  public.inventory_levels, public.inventory_movements, public.inventory_reservations,
  public.inventory_transfers, public.stocktakes, public.suppliers, public.supplier_products,
  public.supplier_contacts, public.purchase_orders, public.goods_receipts, public.product_cost_history,
  public.stores, public.store_products, public.sales_channel_accounts, public.sales_channel_sync_jobs,
  public.sales_channel_sync_runs, public.sales_channel_product_listings, public.external_entity_mappings,
  public.courier_accounts, public.courier_settlements, public.courier_api_logs, public.courier_provider_events,
  public.ai_analysis_runs, public.ai_brain_events, public.automation_rule_executions, public.automation_notes,
  public.background_job_attempts, public.operational_assignments, public.customer_notes,
  public.customer_manual_flags, public.channel_listing_events, public.store_product_price_history,
  public.group_buy_campaigns, public.product_relationships, public.bundle_items
RESTART IDENTITY CASCADE;

-- ============ 2. OPEN CONTROLLED-WRITE GATES FOR SEEDING ============
SELECT set_config(s, 'on', false)
FROM unnest(ARRAY['app.order_write','app.verification_write','app.fulfillment_write','app.delivery_write',
                  'app.payment_write','app.fulfillment_record_write','app.shipment_write','app.exception_write',
                  'app.return_write','app.reservation_write','app.inventory_write','app.inventory_ops_write',
                  'app.customer_write','app.procurement_write','app.financial_write','app.channel_write',
                  'app.catalog_write','app.sync_job_write','app.automation_write','app.operations_assignment',
                  'app.group_buy_quantity_write']) s;

-- ============ 3. CATALOG ============
INSERT INTO public.brands (id, name, slug, brand_type, status, featured, sort_order, created_by) VALUES
 ('0000000a-0000-4000-8000-000000000001','Aarong Style','aarong-style','standard','active',true,1,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000a-0000-4000-8000-000000000002','TechZone BD','techzone-bd','standard','active',true,2,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000a-0000-4000-8000-000000000003','HomeLiving','homeliving','own_brand','active',false,3,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000a-0000-4000-8000-000000000004','BabyCare','babycare','generic','active',false,4,'6700d130-d450-40ba-97fe-c5391a9ff091');

INSERT INTO public.categories (id, parent_id, name, slug, status, featured, sort_order, created_by) VALUES
 ('0000000b-0000-4000-8000-000000000001',NULL,'Fashion','fashion','active',true,1,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000b-0000-4000-8000-000000000002','0000000b-0000-4000-8000-000000000001','Women''s Wear','womens-wear','active',false,1,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000b-0000-4000-8000-000000000003','0000000b-0000-4000-8000-000000000001','Men''s Wear','mens-wear','active',false,2,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000b-0000-4000-8000-000000000004',NULL,'Electronics','electronics','active',true,2,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000b-0000-4000-8000-000000000005',NULL,'Home & Kitchen','home-kitchen','active',false,3,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000b-0000-4000-8000-000000000006',NULL,'Baby Care','baby-care','active',false,4,'6700d130-d450-40ba-97fe-c5391a9ff091');

INSERT INTO public.products (id, name, slug, short_description, brand_id, product_type, supply_model, status, visibility, featured, sku, price, compare_at_price, base_cost, additional_cost, weight, is_purchasable, created_by)
SELECT ('00000001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, name, slug, sd,
       ('0000000a-0000-4000-8000-'||lpad(brand::text,12,'0'))::uuid, ptype::product_type, 'in_stock', pstatus::product_status,
       'visible', feat, sku, price, cmp, bcost, acost, wt, purch, '6700d130-d450-40ba-97fe-c5391a9ff091'
FROM (VALUES
 (1,'Anarkali Cotton Kurti','anarkali-cotton-kurti','Breathable cotton kurti for daily wear',1,'variable','active',true,'KUR-ANK',1850,2200,900,50,0.400,true),
 (2,'Premium Cotton Panjabi','premium-cotton-panjabi','Slim fit panjabi for Eid and events',1,'variable','active',true,'PNJ-PRM',2450,2900,1350,50,0.500,true),
 (3,'Genuine Leather Wallet','genuine-leather-wallet','Hand stitched leather wallet',1,'simple','active',false,'WAL-LTH',1290,1590,580,40,0.150,true),
 (4,'Bluetooth Earbuds A9','bluetooth-earbuds-a9','TWS earbuds with charging case',2,'simple','active',true,'EAR-A9',1990,2490,1050,50,0.120,true),
 (5,'Smart Watch Fit 2','smart-watch-fit-2','Fitness tracking smart watch',2,'simple','active',false,'WCH-FIT2',3490,3990,1980,70,0.180,true),
 (6,'Ceramic Mug Set (4pcs)','ceramic-mug-set-4pcs','Microwave safe ceramic mugs',3,'simple','active',false,'MUG-CER4',890,1090,400,30,1.200,true),
 (7,'Cotton Bedsheet King','cotton-bedsheet-king','King size cotton bedsheet with 2 pillow covers',3,'simple','active',true,'BED-KNG',2790,3290,1550,50,1.500,true),
 (8,'Baby Diaper Pack L (44pcs)','baby-diaper-pack-l','Ultra dry diapers, size L',4,'simple','active',false,'DIA-L44',1150,1290,820,20,1.800,true),
 (9,'Attar Perfume 6ml','attar-perfume-6ml','Long lasting alcohol free attar',4,'simple','active',false,'ATR-6ML',650,790,260,20,0.060,true),
 (10,'Non-stick Frying Pan 26cm','non-stick-frying-pan-26cm','Induction ready non-stick pan',3,'simple','draft',false,'PAN-26',1450,1790,830,30,0.900,false)
) AS v(n,name,slug,sd,brand,ptype,pstatus,feat,sku,price,cmp,bcost,acost,wt,purch);

INSERT INTO public.product_variants (id, product_id, title, sku, status, sort_order, price, compare_at_price, base_cost, additional_cost)
SELECT ('00000002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('00000001-0000-4000-8000-'||lpad(prod::text,12,'0'))::uuid, title, sku, 'active', n, price, cmp, bcost, 50
FROM (VALUES
 (1,1,'Small','KUR-ANK-S',1850,2200,900),
 (2,1,'Medium','KUR-ANK-M',1850,2200,900),
 (3,1,'Large','KUR-ANK-L',1950,2300,940),
 (4,2,'Medium','PNJ-PRM-M',2450,2900,1350),
 (5,2,'Large','PNJ-PRM-L',2450,2900,1350),
 (6,2,'XL','PNJ-PRM-XL',2590,3050,1420)
) AS v(n,prod,title,sku,price,cmp,bcost);

INSERT INTO public.product_categories (product_id, category_id, is_primary, sort_order)
SELECT ('00000001-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid,
       ('0000000b-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid, true, 0
FROM (VALUES (1,2),(2,3),(3,1),(4,4),(5,4),(6,5),(7,5),(8,6),(9,1),(10,5)) AS v(p,c);

INSERT INTO public.product_media (product_id, url, alt_text, sort_order, is_primary)
SELECT ('00000001-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid,
       'https://images.unsplash.com/photo-'||img||'?auto=format&fit=crop&w=800&q=60', alt, 0, true
FROM (VALUES
 (1,'1595777457583-95e059d581b8','Cotton kurti'),
 (2,'1602810318383-e386cc2a3ccf','Cotton panjabi'),
 (3,'1627123424574-724758594e93','Leather wallet'),
 (4,'1590658268037-6bf12165a8df','Wireless earbuds'),
 (5,'1523275335684-37898b6baf30','Smart watch'),
 (6,'1514228742587-6b1558fcca3d','Ceramic mugs'),
 (7,'1522771739844-6a9f6d5f14af','Bedsheet'),
 (8,'1519689680058-324335c77eba','Baby diapers'),
 (9,'1541643600914-78b084683601','Attar perfume'),
 (10,'1584990347449-a2d4c2c9ab13','Frying pan')
) AS v(p,img,alt);

-- ============ 4. LOCATIONS + STOCK ============
INSERT INTO public.inventory_locations (id, name, code, description, status, is_default, created_by) VALUES
 ('00000005-0000-4000-8000-000000000001','Dhaka Main Warehouse','DHK-MAIN','Mirpur DOHS central warehouse','active',true,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('00000005-0000-4000-8000-000000000002','Chattogram Hub','CTG-HUB','Agrabad regional hub','active',false,'6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('00000005-0000-4000-8000-000000000003','Returns & Damage Store','RET-STORE','Returned and damaged stock','active',false,'6700d130-d450-40ba-97fe-c5391a9ff091');

-- simple products at Dhaka
INSERT INTO public.inventory_levels (id, location_id, product_id, variant_id, on_hand, reserved, damaged, incoming, low_stock_threshold, created_by)
SELECT ('00000006-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       '00000005-0000-4000-8000-000000000001',
       ('00000001-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid, NULL, oh, 0, dmg, inc, thr, '6700d130-d450-40ba-97fe-c5391a9ff091'
FROM (VALUES (1,3,64,1,0,10),(2,4,42,2,20,15),(3,5,7,1,10,10),(4,6,88,0,0,12),(5,7,26,0,0,8),(6,8,4,0,30,10),(7,9,120,0,0,20),(8,10,0,0,0,5)) AS v(n,p,oh,dmg,inc,thr);

-- variants at Dhaka
INSERT INTO public.inventory_levels (id, location_id, product_id, variant_id, on_hand, reserved, damaged, incoming, low_stock_threshold, created_by)
SELECT ('00000006-0000-4000-8000-'||lpad((10+n)::text,12,'0'))::uuid,
       '00000005-0000-4000-8000-000000000001', NULL,
       ('00000002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, oh, 0, 0, 0, 8, '6700d130-d450-40ba-97fe-c5391a9ff091'
FROM (VALUES (1,1,34),(2,1,52),(3,1,18),(4,2,29),(5,2,41),(6,2,6)) AS v(n,p,oh);

-- Chattogram secondary stock
INSERT INTO public.inventory_levels (id, location_id, product_id, variant_id, on_hand, reserved, damaged, incoming, low_stock_threshold, created_by)
SELECT ('00000006-0000-4000-8000-'||lpad((20+n)::text,12,'0'))::uuid,
       '00000005-0000-4000-8000-000000000002',
       ('00000001-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid, NULL, oh, 0, 0, 0, 6, '6700d130-d450-40ba-97fe-c5391a9ff091'
FROM (VALUES (1,4,18),(2,6,25),(3,9,44)) AS v(n,p,oh);

INSERT INTO public.inventory_movements (inventory_level_id, movement_type, quantity, reference_type, note, reason, on_hand_before, on_hand_after, created_by, created_at)
SELECT l.id, 'initial', l.on_hand, 'seed', 'Opening stock', NULL, 0, l.on_hand, '6700d130-d450-40ba-97fe-c5391a9ff091', now() - interval '45 days'
FROM public.inventory_levels l WHERE l.on_hand > 0;

INSERT INTO public.inventory_movements (inventory_level_id, movement_type, quantity, reference_type, note, reason, on_hand_before, on_hand_after, damaged_before, damaged_after, created_by, created_at)
SELECT l.id, 'damage', l.damaged, 'seed', 'Damaged during handling', 'damage', l.on_hand, l.on_hand, 0, l.damaged, '6700d130-d450-40ba-97fe-c5391a9ff091', now() - interval '12 days'
FROM public.inventory_levels l WHERE l.damaged > 0;

-- ============ 5. CUSTOMERS ============
INSERT INTO public.customers (id, name, primary_phone, secondary_phone, email, status, block_reason, blocked_at, blocked_by, created_by, created_at)
SELECT ('00000003-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, name, phone, sec, email, st::customer_status,
       CASE WHEN st='blocked' THEN 'Repeated COD refusal on 3 consecutive orders' END,
       CASE WHEN st='blocked' THEN now() - interval '9 days' END,
       CASE WHEN st='blocked' THEN '6700d130-d450-40ba-97fe-c5391a9ff091'::uuid END,
       '6700d130-d450-40ba-97fe-c5391a9ff091', now() - (n||' days')::interval
FROM (VALUES
 (1,'Rakibul Hasan','01711234567','01911234567','rakib.hasan@gmail.com','active'),
 (2,'Nusrat Jahan','01812345678',NULL,'nusrat.j@gmail.com','active'),
 (3,'Mahmudul Karim','01913456789',NULL,NULL,'active'),
 (4,'Sadia Afrin','01714567890','01614567890','sadia.afrin@yahoo.com','active'),
 (5,'Tanvir Ahmed','01815678901',NULL,NULL,'active'),
 (6,'Farhana Islam','01916789012',NULL,'farhana.islam@gmail.com','active'),
 (7,'Imran Hossain','01717890123',NULL,NULL,'active'),
 (8,'Sharmin Akter','01818901234',NULL,'sharmin.akter@gmail.com','active'),
 (9,'Rezaul Karim','01919012345',NULL,NULL,'blocked'),
 (10,'Jannatul Ferdous','01710123456',NULL,NULL,'active'),
 (11,'Ashraful Alam','01811234509',NULL,'ashraf.alam@gmail.com','active'),
 (12,'Mitu Rahman','01912345098',NULL,NULL,'active'),
 (13,'Shakil Mahmud','01713450987',NULL,NULL,'inactive'),
 (14,'Umme Habiba','01814509876',NULL,'habiba.u@gmail.com','active')
) AS v(n,name,phone,sec,email,st);

INSERT INTO public.customer_notes (customer_id, note, created_by, created_at)
SELECT ('00000003-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid, note, '6700d130-d450-40ba-97fe-c5391a9ff091', now() - (d||' days')::interval
FROM (VALUES
 (1,'Regular buyer, always confirms on first call.',20),
 (4,'Prefers delivery after 5 PM.',14),
 (9,'Refused 3 COD parcels — blocked by operations.',9),
 (7,'Asked for bKash advance payment next time.',6),
 (12,'Address is inside Bashundhara R/A, gate entry needed.',3)
) AS v(c,note,d);

INSERT INTO public.customer_manual_flags (customer_id, flag, reason, is_active, created_by, created_at)
SELECT ('00000003-0000-4000-8000-'||lpad(c::text,12,'0'))::uuid, f::customer_manual_flag_type, r, true, '6700d130-d450-40ba-97fe-c5391a9ff091', now() - (d||' days')::interval
FROM (VALUES
 (1,'trusted','Consistent successful COD deliveries',18),
 (7,'payment_risk','Two failed COD collections',6),
 (12,'address_risk','Address incomplete on last order',3),
 (5,'manual_attention','Requested call before every dispatch',10)
) AS v(c,f,r,d);

-- ============ 6. STORES & CHANNELS ============
INSERT INTO public.stores (id, name, slug, code, status, order_number_prefix, default_warehouse_id, created_by) VALUES
 ('0000000d-0000-4000-8000-000000000001','Shop BD Online','shop-bd-online','SHOPBD','active','ORD','00000005-0000-4000-8000-000000000001','6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000d-0000-4000-8000-000000000002','Facebook Live Store','facebook-live-store','FBLIVE','active','FBL','00000005-0000-4000-8000-000000000001','6700d130-d450-40ba-97fe-c5391a9ff091');

INSERT INTO public.store_products (store_id, product_id, status, visibility, selling_price, store_sku, activated_at, created_by)
SELECT '0000000d-0000-4000-8000-000000000001', p.id, 'active','visible', p.price, p.sku, now() - interval '30 days','6700d130-d450-40ba-97fe-c5391a9ff091'
FROM public.products p WHERE p.status = 'active';

INSERT INTO public.courier_accounts (id, provider_id, name, code, environment, status, is_default, created_by)
SELECT ('0000000e-0000-4000-8000-'||lpad(row_number() over (order by cp.sort_order)::text,12,'0'))::uuid,
       cp.id, cp.name||' — Main', upper(cp.code)||'-MAIN','production','active',
       row_number() over (order by cp.sort_order) = 1, '6700d130-d450-40ba-97fe-c5391a9ff091'
FROM public.courier_providers cp;

-- ============ 7. SUPPLIERS & PROCUREMENT ============
INSERT INTO public.suppliers (id, name, supplier_code, contact_person, phone, email, address, city, status, created_by) VALUES
 ('0000000f-0000-4000-8000-000000000001','Dhaka Textile Traders','SUP-DTT','Abdul Momin','01711000111','momin@dhakatextile.com','Islampur Road','Dhaka','active','6700d130-d450-40ba-97fe-c5391a9ff091'),
 ('0000000f-0000-4000-8000-000000000002','China Direct Import','SUP-CDI','Liu Wei','01911000222','liu@chinadirect.cn','Guangzhou Office','Guangzhou','active','6700d130-d450-40ba-97fe-c5391a9ff091');

INSERT INTO public.supplier_contacts (supplier_id, name, phone, email, role, is_primary) VALUES
 ('0000000f-0000-4000-8000-000000000001','Abdul Momin','01711000111','momin@dhakatextile.com','Owner',true),
 ('0000000f-0000-4000-8000-000000000002','Liu Wei','01911000222','liu@chinadirect.cn','Sales Manager',true);

INSERT INTO public.supplier_products (supplier_id, product_id, supplier_sku, supplier_product_name, last_purchase_cost, minimum_order_quantity, lead_time_days, is_preferred)
SELECT ('0000000f-0000-4000-8000-'||lpad(s::text,12,'0'))::uuid,
       ('00000001-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid, sku, nm, cost, moq, lead, true
FROM (VALUES
 (1,3,'DTT-WAL','Leather Wallet',580,20,7),
 (1,6,'DTT-MUG','Ceramic Mug Set',400,20,7),
 (1,7,'DTT-BED','King Bedsheet',1550,10,10),
 (2,4,'CDI-A9','TWS Earbuds A9',1050,50,21),
 (2,5,'CDI-FIT2','Smart Watch Fit 2',1980,30,21)
) AS v(s,p,sku,nm,cost,moq,lead);

INSERT INTO public.purchase_orders (id, purchase_order_number, supplier_id, status, order_date, expected_delivery_date, subtotal, shipping_cost, grand_total, notes, submitted_at, approved_by, approved_at, ordered_at, created_by, supplier_name_snapshot, supplier_code_snapshot, created_at) VALUES
 ('00000010-0000-4000-8000-000000000001','PO-2026-0001','0000000f-0000-4000-8000-000000000001','received',(now()-interval '30 days')::date,(now()-interval '22 days')::date,60000,2500,62500,'Eid stock replenishment',now()-interval '30 days','6700d130-d450-40ba-97fe-c5391a9ff091',now()-interval '29 days',now()-interval '29 days','6700d130-d450-40ba-97fe-c5391a9ff091','Dhaka Textile Traders','SUP-DTT',now()-interval '30 days'),
 ('00000010-0000-4000-8000-000000000002','PO-2026-0002','0000000f-0000-4000-8000-000000000002','ordered',(now()-interval '10 days')::date,(now()+interval '11 days')::date,105000,8000,113000,'Electronics restock from China',now()-interval '10 days','6700d130-d450-40ba-97fe-c5391a9ff091',now()-interval '9 days',now()-interval '9 days','6700d130-d450-40ba-97fe-c5391a9ff091','China Direct Import','SUP-CDI',now()-interval '10 days'),
 ('00000010-0000-4000-8000-000000000003','PO-2026-0003','0000000f-0000-4000-8000-000000000001','pending_approval',(now()-interval '2 days')::date,(now()+interval '8 days')::date,31000,1500,32500,'Bedsheet top-up',now()-interval '2 days',NULL,NULL,NULL,'6700d130-d450-40ba-97fe-c5391a9ff091','Dhaka Textile Traders','SUP-DTT',now()-interval '2 days');

INSERT INTO public.purchase_order_items (purchase_order_id, product_id, product_name_snapshot, sku_snapshot, quantity_ordered, quantity_received, unit_cost, sort_order)
SELECT ('00000010-0000-4000-8000-'||lpad(po::text,12,'0'))::uuid,
       p.id, p.name, p.sku, qty, rec, cost, so
FROM (VALUES (1,3,50,50,580,0),(1,7,20,20,1550,1),(2,4,50,0,1050,0),(2,5,30,0,1980,1),(3,7,20,0,1550,0)) AS v(po,prod,qty,rec,cost,so)
JOIN public.products p ON p.id = ('00000001-0000-4000-8000-'||lpad(v.prod::text,12,'0'))::uuid;

INSERT INTO public.purchase_order_events (purchase_order_id, event_type, from_status, to_status, message, created_by, created_at)
SELECT ('00000010-0000-4000-8000-'||lpad(po::text,12,'0'))::uuid, et::purchase_order_event_type, fs::purchase_order_status, ts::purchase_order_status, msg, '6700d130-d450-40ba-97fe-c5391a9ff091', now() - (d||' days')::interval
FROM (VALUES
 (1,'created',NULL,'draft','Purchase order created',30),
 (1,'approved','pending_approval','approved','Approved by owner',29),
 (1,'ordered','approved','ordered','Sent to supplier',29),
 (1,'received','partially_received','received','All items received',22),
 (2,'created',NULL,'draft','Purchase order created',10),
 (2,'ordered','approved','ordered','Sent to supplier',9),
 (3,'submitted_for_approval','draft','pending_approval','Waiting for approval',2)
) AS v(po,et,fs,ts,msg,d);

INSERT INTO public.goods_receipts (id, receipt_number, purchase_order_id, inventory_location_id, status, received_at, received_by, created_by, created_at) VALUES
 ('00000011-0000-4000-8000-000000000001','GRN-2026-0001','00000010-0000-4000-8000-000000000001','00000005-0000-4000-8000-000000000001','received',now()-interval '22 days','6700d130-d450-40ba-97fe-c5391a9ff091','6700d130-d450-40ba-97fe-c5391a9ff091',now()-interval '22 days');

INSERT INTO public.goods_receipt_items (goods_receipt_id, purchase_order_item_id, quantity_received, quantity_accepted, quantity_damaged, unit_cost_snapshot)
SELECT '00000011-0000-4000-8000-000000000001', poi.id, poi.quantity_ordered, poi.quantity_ordered, 0, poi.unit_cost
FROM public.purchase_order_items poi WHERE poi.purchase_order_id = '00000010-0000-4000-8000-000000000001';

INSERT INTO public.product_cost_history (product_id, cost_type, previous_cost, new_cost, source_type, note, effective_at, created_by, created_at)
SELECT p.id, 'base_cost', p.base_cost - 25, p.base_cost, 'purchase_receipt', 'Cost updated from GRN-2026-0001', now()-interval '22 days', '6700d130-d450-40ba-97fe-c5391a9ff091', now()-interval '22 days'
FROM public.products p WHERE p.sku IN ('WAL-LTH','BED-KNG');

-- ============ 8. ORDERS ============
INSERT INTO public.orders (id, order_number, source, customer_id, customer_name, customer_phone, customer_email, store_id, payment_method, shipping_charge, delivery_charge, packing_charge, verification_priority, risk_level, created_by, placed_at, created_at)
SELECT ('00000004-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       'ORD-2026-'||lpad(n::text,5,'0'), src::order_source, c.id, c.name, c.primary_phone, c.email,
       ('0000000d-0000-4000-8000-'||lpad(store::text,12,'0'))::uuid, pm::payment_method, ship, 70, 20,
       prio::verification_priority, risk::verification_risk_level, '6700d130-d450-40ba-97fe-c5391a9ff091',
       now() - (d||' days')::interval, now() - (d||' days')::interval
FROM (VALUES
 (1,'admin',1,1,'cod',60,42,'normal','none'),
 (2,'facebook',2,2,'cod',80,41,'normal','none'),
 (3,'web',3,1,'cod',60,38,'normal','none'),
 (4,'facebook',4,2,'bkash',60,36,'high','none'),
 (5,'whatsapp',5,2,'cod',120,35,'normal','low'),
 (6,'web',6,1,'cod',60,34,'normal','none'),
 (7,'phone',7,1,'cod',80,33,'urgent','medium'),
 (8,'web',8,1,'cod',60,31,'normal','none'),
 (9,'facebook',10,2,'cod',120,30,'high','medium'),
 (10,'web',11,1,'cod',60,29,'normal','high'),
 (11,'phone',12,1,'cod',80,28,'high','high'),
 (12,'facebook',13,2,'cod',60,27,'normal','low'),
 (13,'web',14,1,'cod',60,26,'normal','none'),
 (14,'web',1,1,'cod',60,24,'normal','none'),
 (15,'facebook',2,2,'cod',80,23,'normal','none'),
 (16,'web',3,1,'bkash',60,22,'normal','none'),
 (17,'whatsapp',4,2,'cod',120,21,'normal','none'),
 (18,'web',5,1,'cod',60,20,'normal','none'),
 (19,'admin',6,1,'cod',60,19,'normal','none'),
 (20,'web',7,1,'cod',80,18,'normal','low'),
 (21,'facebook',8,2,'cod',60,16,'normal','none'),
 (22,'web',10,1,'cod',60,15,'normal','none'),
 (23,'phone',11,1,'cod',120,14,'normal','none'),
 (24,'web',12,1,'cod',60,13,'normal','none'),
 (25,'web',14,1,'cod',60,11,'normal','none'),
 (26,'facebook',1,2,'cod',80,10,'normal','none'),
 (27,'web',2,1,'bkash',60,9,'normal','none'),
 (28,'whatsapp',3,2,'cod',60,8,'normal','none'),
 (29,'web',4,1,'cod',120,7,'normal','medium'),
 (30,'facebook',5,2,'cod',60,6,'normal','low'),
 (31,'web',6,1,'cod',60,5,'normal','none'),
 (32,'web',7,1,'cod',60,4,'normal','medium'),
 (33,'facebook',8,2,'cod',80,3,'normal','high'),
 (34,'web',11,1,'cod',60,2,'normal','none')
) AS v(n,src,cust,store,pm,ship,d,prio,risk)
JOIN public.customers c ON c.id = ('00000003-0000-4000-8000-'||lpad(v.cust::text,12,'0'))::uuid;

INSERT INTO public.order_items (order_id, product_id, variant_id, product_name, variant_name, sku, product_type, quantity, unit_price, compare_at_price, discount_amount, sort_order, unit_base_cost, unit_additional_cost, unit_cost, cost_source, created_at)
SELECT o.id, p.id, pv.id, p.name, pv.title, coalesce(pv.sku, p.sku), p.product_type, x.qty,
       coalesce(pv.price, p.price), coalesce(pv.compare_at_price, p.compare_at_price), 0, x.so,
       coalesce(pv.base_cost, p.base_cost), coalesce(pv.additional_cost, p.additional_cost),
       coalesce(pv.base_cost, p.base_cost) + coalesce(pv.additional_cost, p.additional_cost),
       'product_snapshot', o.created_at
FROM (VALUES
 (1,3,NULL,1,0),(1,9,NULL,2,1),
 (2,1,2,1,0),
 (3,4,NULL,1,0),
 (4,7,NULL,1,0),(4,6,NULL,1,1),
 (5,5,NULL,1,0),
 (6,8,NULL,2,0),
 (7,2,5,1,0),
 (8,9,NULL,3,0),
 (9,4,NULL,2,0),
 (10,1,1,1,0),(10,3,NULL,1,1),
 (11,5,NULL,1,0),
 (12,6,NULL,2,0),
 (13,8,NULL,1,0),
 (14,1,3,2,0),
 (15,2,4,1,0),(15,9,NULL,1,1),
 (16,7,NULL,1,0),
 (17,4,NULL,1,0),
 (18,3,NULL,2,0),
 (19,6,NULL,1,0),
 (20,5,NULL,1,0),
 (21,1,2,1,0),
 (22,8,NULL,2,0),
 (23,2,6,1,0),
 (24,9,NULL,4,0),
 (25,4,NULL,1,0),(25,9,NULL,1,1),
 (26,7,NULL,1,0),
 (27,1,1,2,0),
 (28,6,NULL,3,0),
 (29,5,NULL,1,0),
 (30,2,5,1,0),
 (31,3,NULL,1,0),
 (32,8,NULL,2,0),
 (33,4,NULL,1,0),
 (34,9,NULL,2,0)
) AS x(ord,prod,var,qty,so)
JOIN public.orders o ON o.id = ('00000004-0000-4000-8000-'||lpad(x.ord::text,12,'0'))::uuid
JOIN public.products p ON p.id = ('00000001-0000-4000-8000-'||lpad(x.prod::text,12,'0'))::uuid
LEFT JOIN public.product_variants pv ON x.var IS NOT NULL AND pv.id = ('00000002-0000-4000-8000-'||lpad(x.var::text,12,'0'))::uuid;

UPDATE public.orders o
SET subtotal = t.sub, product_discount = 0
FROM (SELECT order_id, sum(quantity * unit_price) AS sub FROM public.order_items GROUP BY order_id) t
WHERE t.order_id = o.id;

INSERT INTO public.order_addresses (order_id, address_type, recipient_name, phone, address_line, area, district, division, postal_code)
SELECT o.id, 'shipping', o.customer_name, o.customer_phone, a.line, a.area, a.district, a.division, a.postal
FROM public.orders o
JOIN LATERAL (
  SELECT * FROM (VALUES
    (0,'House 12, Road 5, Block C','Mirpur DOHS','Dhaka','Dhaka','1216'),
    (1,'Flat 4B, Green Villa, Road 11','Banani','Dhaka','Dhaka','1213'),
    (2,'Holding 88, CDA Avenue','Agrabad','Chattogram','Chattogram','4100'),
    (3,'Zindabazar Main Road, 3rd Floor','Zindabazar','Sylhet','Sylhet','3100'),
    (4,'House 7, Sonadanga R/A','Sonadanga','Khulna','Khulna','9100'),
    (5,'Plot 21, Board Bazar','Gazipur Sadar','Gazipur','Dhaka','1704')
  ) AS x(k,line,area,district,division,postal)
  WHERE x.k = (('x'||substr(md5(o.order_number),1,8))::bit(32)::bigint % 6)
) a ON true;

-- lifecycle state per order
UPDATE public.orders o SET
  status = s.st::order_status,
  verification_status = s.vs::order_verification_status,
  fulfillment_status = s.fs::order_fulfillment_status,
  delivery_status = s.ds::order_delivery_status,
  payment_status = s.ps::payment_status,
  reservation_status = s.rs::reservation_status,
  paid_amount = CASE WHEN s.ps = 'paid' THEN o.subtotal + o.shipping_charge WHEN s.ps='partial' THEN 1000 ELSE 0 END,
  verification_attempt_count = s.att,
  verification_last_attempt_at = CASE WHEN s.att > 0 THEN o.created_at + interval '3 hours' END,
  verification_confirmed_at = CASE WHEN s.vs = 'confirmed' THEN o.created_at + interval '5 hours' END,
  verification_next_action_at = CASE WHEN s.vs IN ('rescheduled','unreachable') THEN now() + interval '4 hours' END,
  verification_failure_reason = CASE WHEN s.vs = 'unreachable' THEN 'Phone switched off on 3 attempts' WHEN s.vs='failed' THEN 'Customer refused the order' END,
  risk_reason = CASE WHEN o.risk_level <> 'none' THEN 'Previous COD failure history in this area' END,
  cancelled_at = CASE WHEN s.st = 'cancelled' THEN o.created_at + interval '1 day' END,
  fulfillment_location_id = CASE WHEN s.rs IN ('reserved','partial') THEN '00000005-0000-4000-8000-000000000001'::uuid END,
  reserved_at = CASE WHEN s.rs = 'reserved' THEN o.created_at + interval '6 hours' END
FROM (VALUES
 (1,'draft','pending','not_started','not_shipped','unpaid','pending',0),
 (2,'draft','pending','not_started','not_shipped','unpaid','pending',0),
 (3,'created','pending','not_started','not_shipped','unpaid','pending',0),
 (4,'created','pending','not_started','not_shipped','paid','pending',0),
 (5,'created','pending','not_started','not_shipped','unpaid','pending',0),
 (6,'created','pending','not_started','not_shipped','unpaid','pending',0),
 (7,'created','pending','not_started','not_shipped','unpaid','pending',1),
 (8,'created','in_progress','not_started','not_shipped','unpaid','pending',1),
 (9,'created','in_progress','not_started','not_shipped','unpaid','pending',2),
 (10,'created','manual_review','not_started','not_shipped','unpaid','pending',2),
 (11,'created','manual_review','not_started','not_shipped','unpaid','pending',3),
 (12,'created','unreachable','not_started','not_shipped','unpaid','pending',3),
 (13,'created','rescheduled','not_started','not_shipped','unpaid','pending',2),
 (14,'created','confirmed','ready','not_shipped','unpaid','reserved',1),
 (15,'created','confirmed','ready','not_shipped','unpaid','reserved',1),
 (16,'created','confirmed','ready','not_shipped','paid','reserved',1),
 (17,'created','confirmed','picking','not_shipped','unpaid','reserved',1),
 (18,'created','confirmed','picking','not_shipped','unpaid','reserved',2),
 (19,'created','confirmed','packed','not_shipped','unpaid','reserved',1),
 (20,'created','confirmed','ready_for_courier','not_shipped','unpaid','reserved',1),
 (21,'created','confirmed','fulfilled','shipped','unpaid','reserved',1),
 (22,'created','confirmed','fulfilled','shipped','unpaid','reserved',1),
 (23,'created','confirmed','fulfilled','in_transit','unpaid','reserved',1),
 (24,'created','confirmed','fulfilled','in_transit','unpaid','reserved',1),
 (25,'created','confirmed','fulfilled','delivered','paid','reserved',1),
 (26,'created','confirmed','fulfilled','delivered','paid','reserved',1),
 (27,'created','confirmed','fulfilled','delivered','paid','reserved',1),
 (28,'created','confirmed','fulfilled','delivered','paid','reserved',1),
 (29,'created','confirmed','fulfilled','delivery_failed','unpaid','reserved',1),
 (30,'created','confirmed','fulfilled','returned','refunded','reserved',1),
 (31,'created','confirmed','partially_fulfilled','partially_delivered','partial','partial',1),
 (32,'cancelled','cancelled','not_started','not_shipped','unpaid','released',1),
 (33,'cancelled','failed','not_started','not_shipped','unpaid','released',3),
 (34,'cancelled','cancelled','not_started','not_shipped','unpaid','released',0)
) AS s(n,st,vs,fs,ds,ps,rs,att)
WHERE o.id = ('00000004-0000-4000-8000-'||lpad(s.n::text,12,'0'))::uuid;

INSERT INTO public.order_notes (order_id, note, note_type, is_internal, created_by, created_at)
SELECT o.id, 'Order created from '||o.source||' channel.', 'system'::order_note_type, true, '6700d130-d450-40ba-97fe-c5391a9ff091'::uuid, o.created_at FROM public.orders o
UNION ALL
SELECT o.id, 'Customer confirmed the order over phone.', 'general'::order_note_type, true, '6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + interval '5 hours'
FROM public.orders o WHERE o.verification_status = 'confirmed'
UNION ALL
SELECT o.id, 'Order cancelled — customer changed mind before dispatch.', 'system'::order_note_type, true, '6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + interval '1 day'
FROM public.orders o WHERE o.status = 'cancelled';

-- verification attempts + events
INSERT INTO public.order_verification_attempts (order_id, attempt_number, method, status, outcome, notes, failure_reason, started_at, completed_at, duration_seconds, initiated_by, created_at)
SELECT o.id, gs, (ARRAY['manual_call','ai_voice','whatsapp'])[1 + (gs % 3)]::verification_method,
       'completed'::verification_attempt_status,
       CASE
         WHEN o.verification_status = 'confirmed' AND gs = o.verification_attempt_count THEN 'confirmed'
         WHEN o.verification_status = 'unreachable' THEN 'no_answer'
         WHEN o.verification_status = 'manual_review' THEN 'risk_flagged'
         WHEN o.verification_status = 'rescheduled' THEN 'callback_requested'
         WHEN o.verification_status = 'failed' THEN 'rejected'
         ELSE 'no_answer' END::verification_attempt_outcome,
       'Attempt '||gs||' recorded by the verification desk.',
       CASE WHEN o.verification_status IN ('unreachable','failed') THEN 'Customer did not respond' END,
       o.created_at + (gs||' hours')::interval, o.created_at + (gs||' hours')::interval + interval '3 minutes', 90 + gs*15,
       '6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + (gs||' hours')::interval
FROM public.orders o, LATERAL generate_series(1, o.verification_attempt_count) gs
WHERE o.verification_attempt_count > 0;

INSERT INTO public.order_verification_events (order_id, event_type, from_status, to_status, message, created_by, created_at)
SELECT o.id, 'verification_started'::verification_event_type,'pending'::order_verification_status,'in_progress'::order_verification_status,'Verification started', '6700d130-d450-40ba-97fe-c5391a9ff091'::uuid, o.created_at + interval '1 hour'
FROM public.orders o WHERE o.verification_attempt_count > 0
UNION ALL
SELECT o.id,
  CASE o.verification_status
    WHEN 'confirmed' THEN 'verification_confirmed' WHEN 'unreachable' THEN 'verification_unreachable'
    WHEN 'manual_review' THEN 'moved_to_manual_review' WHEN 'rescheduled' THEN 'callback_scheduled'
    WHEN 'failed' THEN 'verification_failed' ELSE 'attempt_completed' END::verification_event_type,
  'in_progress'::order_verification_status, o.verification_status, 'Verification outcome recorded: '||o.verification_status,
  '6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + interval '5 hours'
FROM public.orders o WHERE o.verification_attempt_count > 0;

-- reservations for reserved orders
INSERT INTO public.inventory_reservations (order_id, order_item_id, inventory_level_id, location_id, product_id, variant_id, quantity, status, committed_quantity, created_by, created_at, committed_at, committed_by)
SELECT o.id, oi.id, l.id, l.location_id,
       CASE WHEN oi.variant_id IS NULL THEN oi.product_id END, oi.variant_id, oi.quantity,
       CASE WHEN o.fulfillment_status IN ('fulfilled','partially_fulfilled') THEN 'committed' ELSE 'active' END::reservation_record_status,
       CASE WHEN o.fulfillment_status IN ('fulfilled','partially_fulfilled') THEN oi.quantity ELSE 0 END,
       '6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + interval '6 hours',
       CASE WHEN o.fulfillment_status IN ('fulfilled','partially_fulfilled') THEN o.created_at + interval '1 day' END,
       CASE WHEN o.fulfillment_status IN ('fulfilled','partially_fulfilled') THEN '6700d130-d450-40ba-97fe-c5391a9ff091'::uuid END
FROM public.orders o
JOIN public.order_items oi ON oi.order_id = o.id
JOIN public.inventory_levels l ON l.location_id = '00000005-0000-4000-8000-000000000001'
  AND ((oi.variant_id IS NOT NULL AND l.variant_id = oi.variant_id)
       OR (oi.variant_id IS NULL AND l.variant_id IS NULL AND l.product_id = oi.product_id))
WHERE o.reservation_status IN ('reserved','partial');

UPDATE public.inventory_levels l
SET reserved = t.q
FROM (SELECT inventory_level_id, sum(quantity) q FROM public.inventory_reservations WHERE status='active' GROUP BY 1) t
WHERE t.inventory_level_id = l.id;

-- fulfillments
INSERT INTO public.order_fulfillments (id, order_id, fulfillment_number, status, location_id, started_at, picked_at, packed_at, ready_for_handover_at, inventory_committed_at, inventory_committed_by, created_by, created_at)
SELECT ('00000007-0000-4000-8000-'||lpad(s.n::text,12,'0'))::uuid, o.id, 1, s.st::fulfillment_record_status,
       '00000005-0000-4000-8000-000000000001',
       o.created_at + interval '8 hours',
       CASE WHEN s.st NOT IN ('ready_to_pick','picking') THEN o.created_at + interval '10 hours' END,
       CASE WHEN s.st IN ('packed','ready_for_handover') THEN o.created_at + interval '12 hours' END,
       CASE WHEN s.st = 'ready_for_handover' THEN o.created_at + interval '13 hours' END,
       CASE WHEN s.committed THEN o.created_at + interval '12 hours' END,
       CASE WHEN s.committed THEN '6700d130-d450-40ba-97fe-c5391a9ff091'::uuid END,
       '6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + interval '8 hours'
FROM (VALUES
 (14,'ready_to_pick',false),(15,'ready_to_pick',false),(16,'ready_to_pick',false),
 (17,'picking',false),(18,'qc_pending',false),(19,'packed',true),(20,'ready_for_handover',true),
 (21,'ready_for_handover',true),(22,'ready_for_handover',true),(23,'ready_for_handover',true),(24,'ready_for_handover',true),
 (25,'ready_for_handover',true),(26,'ready_for_handover',true),(27,'ready_for_handover',true),(28,'ready_for_handover',true),
 (29,'ready_for_handover',true),(30,'ready_for_handover',true),(31,'ready_for_handover',true),
 (32,'on_hold',false)
) AS s(n,st,committed)
JOIN public.orders o ON o.id = ('00000004-0000-4000-8000-'||lpad(s.n::text,12,'0'))::uuid;

INSERT INTO public.order_fulfillment_items (fulfillment_id, order_item_id, quantity, picked_quantity, packed_quantity, qc_status, created_at)
SELECT f.id, oi.id, oi.quantity,
       CASE WHEN f.status IN ('ready_to_pick','on_hold') THEN 0 WHEN f.status='picking' THEN greatest(oi.quantity-1,0) ELSE oi.quantity END,
       CASE WHEN f.status IN ('packed','ready_for_handover') THEN oi.quantity ELSE 0 END,
       CASE WHEN f.status IN ('packed','ready_for_handover') THEN 'passed' ELSE 'pending' END::fulfillment_qc_status,
       f.created_at
FROM public.order_fulfillments f JOIN public.order_items oi ON oi.order_id = f.order_id;

INSERT INTO public.order_fulfillment_events (fulfillment_id, order_id, event_type, to_status, message, created_by, created_at)
SELECT f.id, f.order_id, 'fulfillment_created'::fulfillment_event_type,'ready_to_pick'::fulfillment_record_status,'Fulfillment created for picking','6700d130-d450-40ba-97fe-c5391a9ff091'::uuid, f.created_at FROM public.order_fulfillments f
UNION ALL
SELECT f.id, f.order_id, 'packed','packed','Items packed and QC passed','6700d130-d450-40ba-97fe-c5391a9ff091', f.packed_at FROM public.order_fulfillments f WHERE f.packed_at IS NOT NULL
UNION ALL
SELECT f.id, f.order_id, 'ready_for_handover','ready_for_handover','Parcel ready for courier handover','6700d130-d450-40ba-97fe-c5391a9ff091', f.ready_for_handover_at FROM public.order_fulfillments f WHERE f.ready_for_handover_at IS NOT NULL;

-- commit stock for committed fulfillments
INSERT INTO public.inventory_movements (inventory_level_id, movement_type, quantity, reference_type, reference_id, note, on_hand_before, on_hand_after, created_by, created_at)
SELECT r.inventory_level_id, 'fulfillment_out', r.committed_quantity, 'order', r.order_id, 'Committed for dispatch',
       l.on_hand + r.committed_quantity, l.on_hand, '6700d130-d450-40ba-97fe-c5391a9ff091', r.committed_at
FROM public.inventory_reservations r JOIN public.inventory_levels l ON l.id = r.inventory_level_id
WHERE r.status = 'committed';

-- shipments
INSERT INTO public.shipments (id, order_id, fulfillment_id, shipment_number, status, provider_id, courier_account_id, service_type,
  tracking_number, recipient_name, recipient_phone, delivery_address, delivery_area, delivery_city,
  cash_on_delivery_amount, declared_value, weight, booked_at, picked_up_at, delivered_at,
  failure_reason, quoted_delivery_fee, booked_delivery_fee, actual_delivery_fee, cod_fee, collected_amount,
  financials_recorded_at, financials_recorded_by, created_by, created_at)
SELECT ('00000008-0000-4000-8000-'||lpad(s.n::text,12,'0'))::uuid, o.id, f.id,
       'SHP-2026-'||lpad(s.n::text,5,'0'), s.st::shipment_status, ca.provider_id, ca.id, 'standard',
       'TRK'||lpad(s.n::text,9,'0'), a.recipient_name, a.phone, a.address_line, a.area, a.district,
       CASE WHEN o.payment_status = 'paid' AND o.payment_method <> 'cod' THEN 0 ELSE o.grand_total END,
       o.grand_total, 0.8,
       o.created_at + interval '1 day',
       CASE WHEN s.st NOT IN ('booked','booking_requested') THEN o.created_at + interval '1 day 6 hours' END,
       CASE WHEN s.st IN ('delivered','partial_delivered') THEN o.created_at + interval '3 days' END,
       CASE WHEN s.st = 'delivery_failed' THEN 'customer_unreachable' END::shipment_failure_reason,
       80, 80,
       CASE WHEN s.st IN ('delivered','partial_delivered','return_received') THEN 80 END,
       CASE WHEN s.st IN ('delivered','partial_delivered') THEN round(o.grand_total * 0.01, 2) END,
       CASE WHEN s.st = 'delivered' THEN o.grand_total WHEN s.st = 'partial_delivered' THEN round(o.grand_total/2,2) END,
       CASE WHEN s.st IN ('delivered','partial_delivered') THEN o.created_at + interval '3 days' END,
       CASE WHEN s.st IN ('delivered','partial_delivered') THEN '6700d130-d450-40ba-97fe-c5391a9ff091'::uuid END,
       '6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + interval '1 day'
FROM (VALUES
 (21,'booked'),(22,'picked_up'),(23,'in_transit'),(24,'out_for_delivery'),
 (25,'delivered'),(26,'delivered'),(27,'delivered'),(28,'delivered'),
 (29,'delivery_failed'),(30,'return_received'),(31,'partial_delivered')
) AS s(n,st)
JOIN public.orders o ON o.id = ('00000004-0000-4000-8000-'||lpad(s.n::text,12,'0'))::uuid
JOIN public.order_addresses a ON a.order_id = o.id
LEFT JOIN public.order_fulfillments f ON f.order_id = o.id
JOIN LATERAL (SELECT * FROM public.courier_accounts ORDER BY is_default DESC LIMIT 1) ca ON true;

INSERT INTO public.shipment_items (shipment_id, order_item_id, quantity)
SELECT sh.id, oi.id, CASE WHEN sh.status = 'partial_delivered' THEN greatest(oi.quantity - 1, 1) ELSE oi.quantity END
FROM public.shipments sh JOIN public.order_items oi ON oi.order_id = sh.order_id;

INSERT INTO public.shipment_events (shipment_id, order_id, event_type, to_status, message, created_by, created_at)
SELECT sh.id, sh.order_id, 'shipment_created'::shipment_event_type,'draft'::shipment_status,'Shipment created from packed fulfillment','6700d130-d450-40ba-97fe-c5391a9ff091'::uuid, sh.created_at FROM public.shipments sh
UNION ALL
SELECT sh.id, sh.order_id, 'booking_confirmed','booked','Courier booking confirmed, tracking '||sh.tracking_number,'6700d130-d450-40ba-97fe-c5391a9ff091', sh.booked_at FROM public.shipments sh
UNION ALL
SELECT sh.id, sh.order_id, 'shipment_picked_up','picked_up','Rider picked up the parcel','6700d130-d450-40ba-97fe-c5391a9ff091', sh.picked_up_at FROM public.shipments sh WHERE sh.picked_up_at IS NOT NULL
UNION ALL
SELECT sh.id, sh.order_id, 'shipment_delivered','delivered','Parcel delivered and COD collected','6700d130-d450-40ba-97fe-c5391a9ff091', sh.delivered_at FROM public.shipments sh WHERE sh.delivered_at IS NOT NULL
UNION ALL
SELECT sh.id, sh.order_id, 'delivery_failed','delivery_failed','Customer phone switched off, delivery failed','6700d130-d450-40ba-97fe-c5391a9ff091', sh.created_at + interval '3 days' FROM public.shipments sh WHERE sh.status = 'delivery_failed'
UNION ALL
SELECT sh.id, sh.order_id, 'return_received','return_received','Parcel returned to warehouse','6700d130-d450-40ba-97fe-c5391a9ff091', sh.created_at + interval '5 days' FROM public.shipments sh WHERE sh.status = 'return_received';

INSERT INTO public.shipment_exceptions (shipment_id, order_id, exception_type, status, reason, courier_reason, notes, occurred_at, created_by, created_at)
SELECT sh.id, sh.order_id, 'delivery_failed'::shipment_exception_type,'open'::shipment_exception_status,'Customer unreachable at delivery time','Customer phone off','Reschedule for tomorrow morning', sh.created_at + interval '3 days','6700d130-d450-40ba-97fe-c5391a9ff091'::uuid, sh.created_at + interval '3 days'
FROM public.shipments sh WHERE sh.status = 'delivery_failed'
UNION ALL
SELECT sh.id, sh.order_id, 'partial_delivery','under_review','Customer accepted part of the parcel','Partial acceptance','Remaining item coming back', sh.created_at + interval '3 days','6700d130-d450-40ba-97fe-c5391a9ff091', sh.created_at + interval '3 days'
FROM public.shipments sh WHERE sh.status = 'partial_delivered';

-- returns
INSERT INTO public.order_returns (id, order_id, shipment_id, return_number, return_type, status, reason, courier_reason, source,
  requested_at, initiated_at, received_at, inspected_at, completed_at, restocked_at, restocked_by,
  financial_outcome, refund_amount, retained_amount, financial_recorded_at, financial_recorded_by, created_by, created_at)
SELECT '00000009-0000-4000-8000-000000000001', sh.order_id, sh.id, 'RET-2026-00001','return_to_merchant','completed',
       'Customer refused on delivery','Customer refused','courier',
       sh.created_at + interval '3 days', sh.created_at + interval '3 days', sh.created_at + interval '5 days',
       sh.created_at + interval '5 days 2 hours', sh.created_at + interval '5 days 3 hours', sh.created_at + interval '5 days 3 hours',
       '6700d130-d450-40ba-97fe-c5391a9ff091','retained',0,0, sh.created_at + interval '5 days 3 hours',
       '6700d130-d450-40ba-97fe-c5391a9ff091','6700d130-d450-40ba-97fe-c5391a9ff091', sh.created_at + interval '3 days'
FROM public.shipments sh WHERE sh.status = 'return_received';

INSERT INTO public.order_return_items (return_id, order_item_id, quantity_expected, quantity_received, quantity_accepted, condition, reason, received_recorded_at)
SELECT r.id, oi.id, oi.quantity, oi.quantity, oi.quantity, 'good','Unopened parcel returned', r.received_at
FROM public.order_returns r JOIN public.order_items oi ON oi.order_id = r.order_id;

INSERT INTO public.order_return_events (return_id, order_id, event_type, to_status, message, created_by, created_at)
SELECT r.id, r.order_id, 'return_created'::return_event_type,'pending'::order_return_status,'Return opened from courier return event','6700d130-d450-40ba-97fe-c5391a9ff091'::uuid, r.requested_at FROM public.order_returns r
UNION ALL
SELECT r.id, r.order_id, 'items_received','received','Returned items received at warehouse','6700d130-d450-40ba-97fe-c5391a9ff091', r.received_at FROM public.order_returns r
UNION ALL
SELECT r.id, r.order_id, 'inspection_recorded','inspected','Inspection passed, items in good condition','6700d130-d450-40ba-97fe-c5391a9ff091', r.inspected_at FROM public.order_returns r
UNION ALL
SELECT r.id, r.order_id, 'return_completed','completed','Return completed and stock restored','6700d130-d450-40ba-97fe-c5391a9ff091', r.completed_at FROM public.order_returns r;

INSERT INTO public.inventory_movements (inventory_level_id, movement_type, quantity, reference_type, reference_id, note, on_hand_before, on_hand_after, created_by, created_at)
SELECT l.id, 'return_in', ri.quantity_accepted, 'order_return', r.id, 'Accepted return restocked', l.on_hand - ri.quantity_accepted, l.on_hand,
       '6700d130-d450-40ba-97fe-c5391a9ff091', r.restocked_at
FROM public.order_returns r
JOIN public.order_return_items ri ON ri.return_id = r.id
JOIN public.order_items oi ON oi.id = ri.order_item_id
JOIN public.inventory_levels l ON l.location_id = '00000005-0000-4000-8000-000000000001'
  AND ((oi.variant_id IS NOT NULL AND l.variant_id = oi.variant_id)
       OR (oi.variant_id IS NULL AND l.variant_id IS NULL AND l.product_id = oi.product_id));

-- financial adjustments
INSERT INTO public.order_financial_adjustments (order_id, adjustment_type, direction, amount, reason, shipment_id, created_by, created_at)
SELECT sh.order_id, 'courier_charge'::financial_adjustment_type,'expense'::financial_adjustment_direction, sh.actual_delivery_fee, 'Courier delivery charge', sh.id,'6700d130-d450-40ba-97fe-c5391a9ff091'::uuid, sh.delivered_at
FROM public.shipments sh WHERE sh.actual_delivery_fee IS NOT NULL AND sh.delivered_at IS NOT NULL
UNION ALL
SELECT sh.order_id, 'cod_fee','expense', sh.cod_fee, 'COD collection fee', sh.id,'6700d130-d450-40ba-97fe-c5391a9ff091', sh.delivered_at
FROM public.shipments sh WHERE sh.cod_fee IS NOT NULL
UNION ALL
SELECT o.id, 'packing_cost','expense', o.packing_charge, 'Packing material cost', NULL,'6700d130-d450-40ba-97fe-c5391a9ff091', o.created_at + interval '12 hours'
FROM public.orders o WHERE o.fulfillment_status IN ('fulfilled','partially_fulfilled')
UNION ALL
SELECT sh.order_id, 'return_charge','expense', 60, 'Courier return charge', sh.id,'6700d130-d450-40ba-97fe-c5391a9ff091', sh.created_at + interval '5 days'
FROM public.shipments sh WHERE sh.status = 'return_received';

-- courier settlement for delivered COD orders
INSERT INTO public.courier_settlements (id, courier_account_id, settlement_reference, status, settlement_date, expected_amount, actual_amount, notes, finalized_at, finalized_by, created_by, created_at)
SELECT '00000012-0000-4000-8000-000000000001', ca.id, 'STL-2026-W36','settled', (now()-interval '4 days')::date,
       (SELECT coalesce(sum(collected_amount),0) FROM public.shipments WHERE status='delivered'),
       (SELECT coalesce(sum(collected_amount),0) - 80 FROM public.shipments WHERE status='delivered'),
       'Weekly COD settlement', now()-interval '4 days','6700d130-d450-40ba-97fe-c5391a9ff091','6700d130-d450-40ba-97fe-c5391a9ff091', now()-interval '5 days'
FROM public.courier_accounts ca ORDER BY ca.is_default DESC LIMIT 1;

INSERT INTO public.courier_settlement_items (settlement_id, order_id, shipment_id, expected_collected_amount, actual_collected_amount, delivery_charge, cod_charge, net_settlement_amount)
SELECT '00000012-0000-4000-8000-000000000001', sh.order_id, sh.id, sh.cash_on_delivery_amount, sh.collected_amount, sh.actual_delivery_fee, sh.cod_fee,
       sh.collected_amount - coalesce(sh.actual_delivery_fee,0) - coalesce(sh.cod_fee,0)
FROM public.shipments sh WHERE sh.status = 'delivered';

-- ============ 9. INVENTORY OPS ============
INSERT INTO public.inventory_transfers (id, reference_number, from_location_id, to_location_id, status, notes, created_by, dispatched_by, dispatched_at, created_at) VALUES
 ('00000013-0000-4000-8000-000000000001','TRF-2026-0001','00000005-0000-4000-8000-000000000001','00000005-0000-4000-8000-000000000002','in_transit','Chattogram hub replenishment','6700d130-d450-40ba-97fe-c5391a9ff091','6700d130-d450-40ba-97fe-c5391a9ff091',now()-interval '3 days',now()-interval '4 days');

INSERT INTO public.inventory_transfer_items (transfer_id, product_id, product_name_snapshot, sku_snapshot, requested_quantity, shipped_quantity)
SELECT '00000013-0000-4000-8000-000000000001', p.id, p.name, p.sku, 10, 10 FROM public.products p WHERE p.sku = 'EAR-A9';

INSERT INTO public.stocktakes (id, reference_number, location_id, status, notes, started_at, completed_at, created_by, completed_by, created_at) VALUES
 ('00000014-0000-4000-8000-000000000001','STK-2026-0001','00000005-0000-4000-8000-000000000001','completed','Monthly cycle count',now()-interval '8 days',now()-interval '7 days','6700d130-d450-40ba-97fe-c5391a9ff091','6700d130-d450-40ba-97fe-c5391a9ff091',now()-interval '8 days'),
 ('00000014-0000-4000-8000-000000000002','STK-2026-0002','00000005-0000-4000-8000-000000000002','in_progress','Chattogram spot check',now()-interval '1 day',NULL,'6700d130-d450-40ba-97fe-c5391a9ff091',NULL,now()-interval '1 day');

INSERT INTO public.stocktake_items (stocktake_id, inventory_level_id, product_id, variant_id, product_name_snapshot, sku_snapshot, system_quantity, counted_quantity, applied_delta)
SELECT '00000014-0000-4000-8000-000000000001', l.id, l.product_id, l.variant_id, p.name, p.sku, l.on_hand, l.on_hand, 0
FROM public.inventory_levels l JOIN public.products p ON p.id = l.product_id
WHERE l.location_id = '00000005-0000-4000-8000-000000000001' AND l.product_id IS NOT NULL LIMIT 6;

-- ============ 10. AI + AUTOMATION HISTORY ============
INSERT INTO public.ai_analysis_runs (id, analysis_type, entity_type, status, provider, model, requested_by, started_at, completed_at, duration_ms, insight_count, recommendation_count, summary, created_at) VALUES
 ('00000015-0000-4000-8000-000000000001','operations_summary','system','completed','lovable','google/gemini-3-flash','6700d130-d450-40ba-97fe-c5391a9ff091',now()-interval '2 days',now()-interval '2 days' + interval '9 seconds',9000,3,3,'Operations are healthy overall, but COD failure rate in Chattogram is rising and two SKUs are close to stock-out.',now()-interval '2 days'),
 ('00000015-0000-4000-8000-000000000002','inventory_review','system','completed','lovable','google/gemini-3-flash','6700d130-d450-40ba-97fe-c5391a9ff091',now()-interval '1 day',now()-interval '1 day' + interval '7 seconds',7000,2,2,'Two fast-moving SKUs will run out within a week at current velocity.',now()-interval '1 day');

INSERT INTO public.ai_insights (id, analysis_run_id, entity_type, category, severity, title, summary, confidence, evidence, status, created_at, expires_at)
SELECT ('00000016-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, ('00000015-0000-4000-8000-'||lpad(run::text,12,'0'))::uuid,
       'system', cat::ai_insight_category, sev::ai_insight_severity, title, summ, conf, '{}'::jsonb, 'active', now()-(d||' days')::interval, now()+interval '5 days'
FROM (VALUES
 (1,1,'delivery','high','COD failure rate rising outside Dhaka','3 of the last 11 shipments outside Dhaka failed or returned, roughly 27% against a 9% Dhaka rate.',0.82,2),
 (2,1,'verification','medium','Unverified orders ageing past 24 hours','Several created orders are still pending verification more than a day after being placed.',0.74,2),
 (3,1,'financial','low','Courier charges eating into COD margin','Delivery and COD fees average about 5% of collected value this week.',0.68,2),
 (4,2,'inventory','critical','Smart Watch Fit 2 close to stock-out','Only 7 units remain against recent weekly demand of 5-6 units.',0.9,1),
 (5,2,'inventory','high','Baby diaper stock below reorder point','4 units on hand with 30 incoming, but the incoming PO is still not received.',0.85,1)
) AS v(n,run,cat,sev,title,summ,conf,d);

INSERT INTO public.ai_recommendations (analysis_run_id, insight_id, entity_type, recommendation_type, priority, title, description, suggested_action, confidence, status, created_at)
SELECT ('00000015-0000-4000-8000-'||lpad(run::text,12,'0'))::uuid, ('00000016-0000-4000-8000-'||lpad(ins::text,12,'0'))::uuid,
       'system', rtype, prio::ai_recommendation_priority, title, descr, act, conf, st::ai_recommendation_status, now()-(d||' days')::interval
FROM (VALUES
 (1,1,'process_change','high','Require advance payment outside Dhaka','Ask for a partial bKash advance for high-value COD orders outside Dhaka.','Enable advance payment rule for Chattogram and Sylhet',0.8,'pending',2),
 (1,2,'operational','urgent','Clear the ageing verification queue','Assign the 5 oldest pending orders to the verification desk today.','Open the verification queue',0.86,'accepted',2),
 (1,3,'financial','medium','Renegotiate courier rates','Current per-parcel charge is above market for Dhaka volume.','Review courier contract',0.6,'pending',2),
 (2,4,'procurement','urgent','Reorder Smart Watch Fit 2','Raise a purchase order for at least 30 units now.','Create purchase order',0.9,'pending',1)
) AS v(run,ins,rtype,prio,title,descr,act,conf,st,d);

INSERT INTO public.automation_rule_executions (rule_id, source_event_id, event_type, entity_type, entity_id, status, input_snapshot, result, error_message, started_at, completed_at, created_at)
SELECT r.id, 'seed-'||o.order_number||'-'||r.id, 'order.created','order', o.id,
       (ARRAY['completed','completed','completed','skipped','failed'])[1 + (row_number() over (order by o.created_at) % 5)]::automation_execution_status,
       jsonb_build_object('order_number', o.order_number, 'source', o.source),
       jsonb_build_object('actions_run', 1),
       CASE WHEN (row_number() over (order by o.created_at) % 5) = 4 THEN 'Target operator no longer active' END,
       o.created_at + interval '1 minute', o.created_at + interval '1 minute 2 seconds', o.created_at + interval '1 minute'
FROM public.orders o
JOIN LATERAL (SELECT id FROM public.automation_rules ORDER BY created_at LIMIT 1) r ON true
WHERE o.status <> 'draft';

-- ============ 11. CLOSE GATES ============
SELECT set_config(s, 'off', false)
FROM unnest(ARRAY['app.order_write','app.verification_write','app.fulfillment_write','app.delivery_write',
                  'app.payment_write','app.fulfillment_record_write','app.shipment_write','app.exception_write',
                  'app.return_write','app.reservation_write','app.inventory_write','app.inventory_ops_write',
                  'app.customer_write','app.procurement_write','app.financial_write','app.channel_write',
                  'app.catalog_write','app.sync_job_write','app.automation_write','app.operations_assignment',
                  'app.group_buy_quantity_write']) s;