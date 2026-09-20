plan "Kitchen Extension" units:m

level ground "Ground" ground

room kitchen "Kitchen" kitchen rect 0,0 4x4

outdoor terrace "Terrace" rect 4,0 4x4

fixture counter in:kitchen at 0.2,0.2 size 3.5x0.6 "Counter Run" depth:0.6 id:counter_run

door kitchen>terrace w2.4 on:kitchen.east glazed id:kitchen_glazed_doors
