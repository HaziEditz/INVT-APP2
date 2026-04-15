package com.khybertech.taxi360driver.Chat;

import android.animation.ObjectAnimator;
import android.support.v7.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.khybertech.taxi360driver.R;

import java.util.List;

/**
 * Created by AK on 24/12/2016.
 */

public class ChatAdapter extends RecyclerView.Adapter<ChatAdapter.ViewHolder> {

    private List<String> mDataset;
    private List<String> mtime,mName;
    List<Integer> keys;

    public ChatAdapter(List<String> mDataset,List<String> mtime,List<String> mName,List<Integer> keys) {
        this.mDataset = mDataset;
        this.keys = keys;
        this.mtime = mtime;
        this.mName = mName;
    }

    @Override
    public ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.row_chat,null);
        ViewHolder vh = new ViewHolder(v);
        return vh;
    }

    @Override
    public void onBindViewHolder(ViewHolder holder, int position) {
        if (keys.get(position) == 1){
            holder.chatoutgoing.setVisibility(View.VISIBLE);
            holder.txt_row_chat_outgoing.setVisibility(View.VISIBLE);
            holder.txt_row_chat_outgoing.setText(mDataset.get(position));
            holder.txt_outgoingtime.setText(mtime.get(position));
            holder.txt_sdrivername.setText(mName.get(position));
            holder.txt_row_chat.setVisibility(View.GONE);
            holder.chatincoming.setVisibility(View.GONE);
        }
        else if (keys.get(position) == 0){
            holder.chatincoming.setVisibility(View.VISIBLE);
            holder.txt_row_chat.setVisibility(View.VISIBLE);
            holder.txt_row_chat.setText(mDataset.get(position));
            holder.txt_rdrivername.setText(mName.get(position));
            holder.txt_incomingtime.setText(mtime.get(position));
            holder.txt_row_chat_outgoing.setVisibility(View.GONE);
            holder.chatoutgoing.setVisibility(View.GONE);
        }
        animate(holder);
    }

    public static void animate(RecyclerView.ViewHolder vh){
        ObjectAnimator animator = ObjectAnimator.ofFloat(vh.itemView,"translationY",100,0);
        animator.setDuration(500);
        animator.start();
    }

    @Override
    public int getItemCount() {
        return mDataset.size();
    }

    public static class ViewHolder extends RecyclerView.ViewHolder{
        public TextView txt_row_chat,txt_incomingtime,txt_rdrivername,txt_row_chat_outgoing,txt_outgoingtime,txt_sdrivername;
        public LinearLayout chatincoming , chatoutgoing;
        ProgressBar pb_chat_inbox;
        public ViewHolder(View itemView) {
            super(itemView);

            chatincoming = (LinearLayout)itemView.findViewById(R.id.Layout_row_chat_incomming) ;
            chatoutgoing = (LinearLayout)itemView.findViewById(R.id.Layout_row_chat_outgoing) ;
            pb_chat_inbox = (ProgressBar) itemView.findViewById(R.id.pb_chat_inbox);
            txt_row_chat = (TextView) itemView.findViewById(R.id.txt_row_chat);

            txt_sdrivername = (TextView) itemView.findViewById(R.id.sdrivername);
            txt_rdrivername = (TextView) itemView.findViewById(R.id.rdrivername);

            txt_outgoingtime = (TextView) itemView.findViewById(R.id.smsgtime);
            txt_incomingtime = (TextView) itemView.findViewById(R.id.rmsgtime);
            txt_row_chat_outgoing = (TextView) itemView.findViewById(R.id.txt_row_chat_outgoing);
        }
    }
}
