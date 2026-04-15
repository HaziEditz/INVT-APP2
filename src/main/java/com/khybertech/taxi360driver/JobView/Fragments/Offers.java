package com.khybertech.taxi360driver.JobView.Fragments;


import android.app.ProgressDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ListView;
import android.widget.SimpleAdapter;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.OfferedJobDetail;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A simple {@link Fragment} subclass.
 */
public class Offers extends Fragment {

    String url_offers = "";//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverOfferedJobs";
    Context c;
    SecurePreferences pref;
    SimpleAdapter adapter_list_offers;
    ListView lv_fragment_offers;
    List<HashMap<String,Object>> ls;


    public Offers() {
        // Required empty public constructor
    }


    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_offers, container, false);
        lv_fragment_offers = (ListView) v.findViewById(R.id.lv_fragment_offers);
        ls = new ArrayList<>();
        return v;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        c = appcontext.getInstance().con;//getActivity().getApplicationContext();
//        pref = PreferenceManager.getDefaultSharedPreferences(getContext());
        pref = appcontext.getInstance().pref;
        url_offers = appcontext.getInstance().link;
    }

    @Override
    public void setUserVisibleHint(boolean isVisibleToUser) {
        super.setUserVisibleHint(isVisibleToUser);

            if(isVisibleToUser){
                Log.d("MyTag", "My Fragment is visible");
                c = appcontext.getInstance().con;
                //getActivity().getApplicationContext();
//                pref = PreferenceManager.getDefaultSharedPreferences(c);
//
//                if (pref.getInt("offersstatus", 0) == 1) {
//                    setdata(pref.getString("offersdata", null));
//                    Log.d("offersdata", pref.getString("offersdata", null));
//                    //   break;
//                } else {
//                    new Handler().postDelayed(new Runnable() {
//                        @Override
//                        public void run() {
//                            setdata(pref.getString("offersdata", null));
//                        }
//                    }, 1000);
//                }

            }

    }
    @Override
    public void onResume() {
        super.onResume();
        Log.e("fragmentDataoffer","OnResume");
    }

    StringRequest postRequest;

    @Override
    public void onPause() {
        super.onPause();
       //postRequest.cancel();
        Log.e("fragmentDataoffer","OnPause");
    }

    @Override
    public void onStop() {
        super.onStop();
        Log.e("fragmentDataoffer","OnStop");

    }

    @Override
    public void onStart() {
        super.onStart();
     // MakePostRequest();
       // new getCurrentJobs().execute();
        Log.e("fragmentDataoffer","OnStart");
//        while(true) {
//            new Handler().postDelayed(new Runnable() {
//                @Override
//                public void run() {
//                    setdata(pref.getString("offersdata", null));
//
//
//                }
//            }, 4000);
//        }
    }

    void MakePostRequest() {

        postRequest = new StringRequest(Request.Method.POST, url_offers,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        // pd.dismiss();
                        setdata(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(c, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
                params.put("DriverId", appcontext.getInstance().DriverId+"" );

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(c).add(postRequest);
    }

  public  void setdata(String s) {

        // pd.dismiss();
        try {
            ls.clear();
            Log.e("offeredjob",s);
//            JSONObject obj = new JSONObject(s);
            JSONArray arr = new JSONArray(s);
            for (int i = 0; i < arr.length(); i++){
                int booking_id = arr.getJSONObject(i).getInt("BookingId");
                String passenger_name = arr.getJSONObject(i).getString("Name");
                String passenger_contact = arr.getJSONObject(i).getString("PassengerId");
                HashMap<String,Object> hm = new HashMap<>();
                hm.put("booking_id",booking_id);
                hm.put("passenger_name",passenger_name);
                hm.put("passenger_contact",passenger_contact);
                ls.add(hm);
            }
            String[] from = {"booking_id","passenger_name","passenger_contact"};
            int[] to = {R.id.txt_list_current_bookingid,R.id.txt_list_current_passengername,R.id.txt_list_current_passengercontact};
            adapter_list_offers = new SimpleAdapter(getActivity(),ls,R.layout.row_list_fragments,from,to);
            adapter_list_offers.notifyDataSetChanged();
            lv_fragment_offers.setAdapter(adapter_list_offers);
            lv_fragment_offers.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                @Override
                public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
                    String booking_id = ((TextView)view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
                    startActivity(new Intent(getActivity(), OfferedJobDetail.class).putExtra("booking_id",booking_id));
                }
            });
        Log.e("fragmentData",s);}
        catch (Exception ex){

            ex.printStackTrace();
        }

    }


    public class getCurrentJobs extends AsyncTask<Void,Void,String> {
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
          //  pd = ProgressDialog.show(getActivity(),"360taxi Taxi","Downloading",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try{
                URL url = new URL(url_offers);
                HttpURLConnection conn = (HttpURLConnection)url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                String params = "DriverId="+appcontext.getInstance().DriverId;
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){
                Log.e("fragmentData",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
           // pd.dismiss();
            try {
                ls.clear();
                JSONObject obj = new JSONObject(s);
                JSONArray arr = obj.getJSONArray("DriverJobsInfo");
                for (int i = 0; i < arr.length(); i++){
                    int booking_id = arr.getJSONObject(i).getInt("BookingId");
                    String passenger_name = arr.getJSONObject(i).getString("Name");
                    String passenger_contact = arr.getJSONObject(i).getString("PassengerId");
                    HashMap<String,Object> hm = new HashMap<>();
                    hm.put("booking_id",booking_id);
                    hm.put("passenger_name",passenger_name);
                    hm.put("passenger_contact",passenger_contact);
                    ls.add(hm);
                }
                String[] from = {"booking_id","passenger_name","passenger_contact"};
                int[] to = {R.id.txt_list_current_bookingid,R.id.txt_list_current_passengername,R.id.txt_list_current_passengercontact};
                adapter_list_offers = new SimpleAdapter(getActivity(),ls,R.layout.row_list_fragments,from,to);
                adapter_list_offers.notifyDataSetChanged();
                lv_fragment_offers.setAdapter(adapter_list_offers);
                lv_fragment_offers.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                    @Override
                    public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
                        String booking_id = ((TextView)view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
                        startActivity(new Intent(getActivity(), OfferedJobDetail.class).putExtra("booking_id",booking_id));
                    }
                });
            }
            catch (Exception ex){

            }
            Log.e("fragmentData",s);
        }
    }
}
