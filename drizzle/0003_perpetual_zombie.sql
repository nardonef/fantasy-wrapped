CREATE TABLE "team_season_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"bench_regret_rate" double precision NOT NULL,
	"flippable_loss_rate" double precision NOT NULL,
	"all_play_win_pct" double precision NOT NULL,
	"luck_delta" double precision NOT NULL,
	"longest_win_streak" integer NOT NULL,
	"longest_loss_streak" integer NOT NULL,
	"transaction_total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_season_stats" ADD CONSTRAINT "team_season_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_season_stats_team_engine_ux" ON "team_season_stats" USING btree ("team_id","engine_version");