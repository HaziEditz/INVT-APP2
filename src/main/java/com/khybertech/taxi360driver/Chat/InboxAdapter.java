package com.khybertech.taxi360driver.Chat;

import android.animation.ObjectAnimator;
import android.app.Activity;
import android.content.Intent;
import android.support.v7.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.khybertech.taxi360driver.R;

import java.util.List;

/**
 * Created by AK on 24/12/2016.
 */

public class InboxAdapter extends RecyclerView.Adapter<InboxAdapter.ViewHolder> {

    List<ModelInbox> ls;
    Activity ctx;
    String id = "";

    public InboxAdapter(List<ModelInbox> ls, Activity ctx) {
        this.ls = ls;
        this.ctx = ctx;
    }

    @Override
    public ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.chatlistitems,null);
        ViewHolder vh = new ViewHolder(v);
        return vh;
    }

    @Override
    public void onBindViewHolder(ViewHolder holder, int position) {
        holder.txt_name_inbox.setText(ls.get(position).getName());
        holder.txt_unreadmessage_inbox.setText(ls.get(position).getUnread());
        holder.txt_id_inbox.setText(ls.get(position).getId());
        holder.txt_playerid_inbox.setText(ls.get(position).getPlayerid());
    }

    public static void animate(RecyclerView.ViewHolder vh){
        ObjectAnimator animator = ObjectAnimator.ofFloat(vh.itemView,"translationY",100,0);
        animator.setDuration(500);
        animator.start();
    }

    @Override
    public int getItemCount() {
        return ls.size();
    }

    public class ViewHolder extends RecyclerView.ViewHolder{

        TextView txt_name_inbox,txt_unreadmessage_inbox,txt_id_inbox,txt_playerid_inbox;

        public ViewHolder(View itemView) {
            super(itemView);
            itemView.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    ctx.startActivity(new Intent(ctx,ChatActivity.class).putExtra("id",txt_id_inbox.getText().toString()).putExtra("name",txt_name_inbox.getText().toString()).putExtra("player_id",txt_playerid_inbox.getText().toString()));
                }
            });
            txt_name_inbox = (TextView) itemView.findViewById(R.id.txt_name_inbox);
            txt_unreadmessage_inbox = (TextView) itemView.findViewById(R.id.txt_unreadmessage_inbox);
            txt_id_inbox = (TextView) itemView.findViewById(R.id.txt_id_inbox);
            txt_playerid_inbox = (TextView) itemView.findViewById(R.id.txt_playerid_inbox);
        }
    }
}
