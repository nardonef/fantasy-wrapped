CREATE TABLE "draft_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"team_id" uuid,
	"player_id" uuid,
	"round" integer NOT NULL,
	"pick_no" integer NOT NULL,
	"is_keeper" boolean DEFAULT false NOT NULL,
	"amount" integer
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_league_id" text NOT NULL,
	"season" integer NOT NULL,
	"name" text NOT NULL,
	"total_teams" integer NOT NULL,
	"roster_positions" jsonb NOT NULL,
	"scoring_settings" jsonb NOT NULL,
	"playoff_start_week" integer,
	"playoff_teams" integer,
	"last_scored_week" integer,
	"previous_provider_league_id" text,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"synced_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid,
	"team_a_score" double precision NOT NULL,
	"team_b_score" double precision,
	"is_playoff" boolean DEFAULT false NOT NULL,
	"bracket_round" text
);
--> statement-breakpoint
CREATE TABLE "player_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"points" double precision NOT NULL,
	"started" boolean NOT NULL,
	"slot" text
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_player_id" text NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"nfl_team" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"provider_roster_id" text NOT NULL,
	"provider_user_id" text,
	"display_name" text NOT NULL,
	"team_name" text,
	"avatar_url" text,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"ties" integer DEFAULT 0 NOT NULL,
	"points_for" double precision DEFAULT 0 NOT NULL,
	"points_against" double precision DEFAULT 0 NOT NULL,
	"final_rank" integer,
	"playoff_seed" integer,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"provider_tx_id" text NOT NULL,
	"week" integer NOT NULL,
	"type" text NOT NULL,
	"roster_ids" jsonb NOT NULL,
	"assets" jsonb NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wrapped_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"script" jsonb NOT NULL,
	"copy" jsonb,
	"copy_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_scores" ADD CONSTRAINT "player_scores_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_scores" ADD CONSTRAINT "player_scores_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_scores" ADD CONSTRAINT "player_scores_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_scripts" ADD CONSTRAINT "wrapped_scripts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_league_pick_ux" ON "draft_picks" USING btree ("league_id","pick_no");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_provider_league_season_ux" ON "leagues" USING btree ("provider","provider_league_id","season");--> statement-breakpoint
CREATE UNIQUE INDEX "matchups_league_week_team_ux" ON "matchups" USING btree ("league_id","week","team_a_id");--> statement-breakpoint
CREATE INDEX "matchups_league_week_ix" ON "matchups" USING btree ("league_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "player_scores_team_week_player_ux" ON "player_scores" USING btree ("team_id","week","player_id");--> statement-breakpoint
CREATE INDEX "player_scores_league_week_ix" ON "player_scores" USING btree ("league_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "players_provider_player_ux" ON "players" USING btree ("provider","provider_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_league_roster_ux" ON "teams" USING btree ("league_id","provider_roster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_league_tx_ux" ON "transactions" USING btree ("league_id","provider_tx_id");--> statement-breakpoint
CREATE INDEX "transactions_league_week_ix" ON "transactions" USING btree ("league_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "wrapped_scripts_team_engine_ux" ON "wrapped_scripts" USING btree ("team_id","engine_version");